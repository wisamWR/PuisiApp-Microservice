import random
import time
import uuid

import psycopg2
from psycopg2.extras import Json

from app.config import load_settings
from app.processor import proses_kandidat
from app.similarity import buat_bucket_lsh

TOTAL = 1000
rng = random.Random(42)


def main():
    conn = psycopg2.connect(load_settings().database_url)

    try:
        cur = conn.cursor()

        target_signature = [
            rng.getrandbits(64) for _ in range(128)
        ]

        records = []
        bucket_rows = []

        for i in range(TOTAL):
            poem_id = str(uuid.uuid4())

            if i == 0:
                signature = target_signature
            else:
                signature = [
                    rng.getrandbits(64) for _ in range(128)
                ]

            records.append((
                poem_id,
                1,
                100,
                Json(signature),
                Json([]),
            ))

            for band, bucket_hash in buat_bucket_lsh(signature):
                bucket_rows.append((
                    poem_id,
                    1,
                    None,
                    band,
                    bucket_hash,
                ))

        start_seed = time.perf_counter()

        cur.executemany(
            """
            INSERT INTO poem_signatures
            (poem_id, version, shingle_count, signature, stanza_signatures)
            VALUES (%s, %s, %s, %s, %s)
            """,
            records,
        )

        cur.executemany(
            """
            INSERT INTO lsh_buckets
            (poem_id, version, stanza, band, bucket_hash)
            VALUES (%s, %s, %s, %s, %s)
            """,
            bucket_rows,
        )

        seed_time = time.perf_counter() - start_seed

        payload = {
            "poem_id": str(uuid.uuid4()),
            "version": 1,
            "shingle_count": 100,
            "signature": target_signature,
            "stanza_signatures": [],
        }

        times = []
        result = []

        for _ in range(10):
            start = time.perf_counter()
            result = proses_kandidat(cur, payload)
            times.append((time.perf_counter() - start) * 1000)

        print("TOTAL FINGERPRINT:", TOTAL)
        print("TOTAL BUCKETS:", len(bucket_rows))
        print("CANDIDATES FOUND:", len(result))
        print("BEST SCORE:", result[0]["jaccard_estimate"] if result else None)
        print("SEED TIME (ms):", round(seed_time * 1000, 3))
        print("QUERY + SCORING AVG (ms):", round(sum(times) / len(times), 3))
        print("QUERY + SCORING MIN (ms):", round(min(times), 3))
        print("QUERY + SCORING MAX (ms):", round(max(times), 3))

    finally:
        conn.rollback()
        conn.close()
        print("DATABASE ROLLBACK: SUCCESS")


if __name__ == "__main__":
    main()
