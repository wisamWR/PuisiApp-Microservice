import os
from pathlib import Path

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from app.similarity import buat_bucket_lsh

FOLDER_MIGRASI = Path(__file__).resolve().parents[2] / "migrations"
# Kunci advisory sama dengan libs/node migrasi.js agar dua replika tidak
# menjalankan migrasi bersamaan.
KUNCI_ADVISORY = 734_215_001


def get_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL belum dikonfigurasi")
    return psycopg2.connect(database_url)


def jalankan_migrasi(conn, folder: Path = FOLDER_MIGRASI) -> list[str]:
    """Menjalankan migrations/*.sql urut nama, dicatat di schema_migrasi.

    Tabel outbox dan publication sudah dibuat skrip init Postgres
    (infra/postgres/init/70-similarity.sql); folder ini berisi tabel layanan.
    """
    dijalankan = []
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (KUNCI_ADVISORY,))
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrasi (
                    nama TEXT PRIMARY KEY,
                    dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("SELECT nama FROM schema_migrasi")
            sudah = {baris[0] for baris in cur.fetchall()}

        conn.autocommit = False
        for berkas in sorted(folder.glob("*.sql")):
            if berkas.name in sudah:
                continue
            with conn:
                with conn.cursor() as cur:
                    cur.execute(berkas.read_text(encoding="utf-8-sig"))
                    cur.execute(
                        "INSERT INTO schema_migrasi (nama) VALUES (%s)",
                        (berkas.name,),
                    )
            dijalankan.append(berkas.name)
    finally:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (KUNCI_ADVISORY,))
        conn.autocommit = False
    return dijalankan


def catat_first_seen(cur, poem_id: str) -> None:
    """Mencatat waktu pertama puisi ditemukan tanpa mengubah catatan lama."""
    cur.execute(
        """
        INSERT INTO poem_first_seen (poem_id)
        VALUES (%s)
        ON CONFLICT (poem_id) DO NOTHING
        """,
        (poem_id,),
    )


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

    # Puisi tanpa shingle tidak diindeks (signature sentinel, lihat processor).
    if payload["shingle_count"] == 0:
        return

    for band, bucket_hash in buat_bucket_lsh(payload["signature"]):
        bucket_rows.append((poem_id, version, None, band, bucket_hash))

    for stanza_data in payload["stanza_signatures"]:
        for band, bucket_hash in buat_bucket_lsh(stanza_data["signature"]):
            bucket_rows.append((poem_id, version, stanza_data["stanza"], band, bucket_hash))

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

    params.extend([poem_id, poem_id])

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
        JOIN poem_first_seen candidate_first_seen
          ON candidate_first_seen.poem_id = p.poem_id
        JOIN poem_first_seen source_first_seen
          ON source_first_seen.poem_id = %s
        WHERE b.poem_id <> %s
          AND candidate_first_seen.first_seen_at
              < source_first_seen.first_seen_at
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
