import os

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from app.similarity import buat_bucket_lsh


def get_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL belum dikonfigurasi")
    return psycopg2.connect(database_url)
from psycopg2.extras import Json, RealDictCursor

from app.similarity import buat_bucket_lsh


def simpan_fingerprint(cur, payload: dict) -> None:
    poem_id = payload["poem_id"]
    version = payload["version"]

    cur.execute(
        """
        INSERT INTO poem_signatures (
            poem_id, version, shingle_count, signature, stanza_signatures
        )
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (poem_id, version) DO NOTHING
        """,
        (
            poem_id,
            version,
            payload["shingle_count"],
            Json(payload["signature"]),
            Json(payload["stanza_signatures"]),
        ),
    )

    bucket_rows = []

    for band, bucket_hash in buat_bucket_lsh(payload["signature"]):
        bucket_rows.append((poem_id, version, None, band, bucket_hash))

    for stanza_data in payload["stanza_signatures"]:
        for band, bucket_hash in buat_bucket_lsh(stanza_data["signature"]):
            bucket_rows.append(
                (poem_id, version, stanza_data["stanza"], band, bucket_hash)
            )

    cur.executemany(
        """
        INSERT INTO lsh_buckets (
            poem_id, version, stanza, band, bucket_hash
        )
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        bucket_rows,
    )


def cari_kandidat(cur, payload: dict) -> list[dict]:
    poem_id = payload["poem_id"]
    input_buckets = []

    for band, bucket_hash in buat_bucket_lsh(payload["signature"]):
        input_buckets.append(("whole", band, bucket_hash))

    for stanza_data in payload["stanza_signatures"]:
        for band, bucket_hash in buat_bucket_lsh(stanza_data["signature"]):
            input_buckets.append(("stanza", band, bucket_hash))

    if not input_buckets:
        return []

    values_sql = ", ".join(["(%s, %s, %s)"] * len(input_buckets))
    params = []

    for kind, band, bucket_hash in input_buckets:
        params.extend([kind, band, bucket_hash])

    params.append(poem_id)

    query = f"""
        WITH input_buckets(kind, band, bucket_hash) AS (
            VALUES {values_sql}
        )
        SELECT
            p.poem_id,
            p.version,
            p.shingle_count,
            p.signature,
            p.stanza_signatures,
            b.stanza AS matched_stanza,
            i.kind AS match_kind,
            COUNT(*) AS matching_buckets
        FROM input_buckets i
        JOIN lsh_buckets b
          ON b.band = i.band
         AND b.bucket_hash = i.bucket_hash
         AND (
             (i.kind = 'whole' AND b.stanza IS NULL)
             OR
             (i.kind = 'stanza' AND b.stanza IS NOT NULL)
         )
        JOIN poem_signatures p
          ON p.poem_id = b.poem_id
         AND p.version = b.version
        WHERE b.poem_id <> %s
        GROUP BY
            p.poem_id,
            p.version,
            p.shingle_count,
            p.signature,
            p.stanza_signatures,
            b.stanza,
            i.kind
        ORDER BY matching_buckets DESC
    """

    with cur.connection.cursor(cursor_factory=RealDictCursor) as read_cur:
        read_cur.execute(query, params)
        return [dict(row) for row in read_cur.fetchall()]
