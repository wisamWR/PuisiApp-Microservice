import argparse
import hashlib
import json
import os
import sys
from datetime import timezone

import psycopg2


HASH_NOL = "0" * 64


def normalisasi_waktu(waktu):
    if waktu.tzinfo is None:
        waktu = waktu.replace(tzinfo=timezone.utc)
    return waktu.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def hitung_hash(index, poem_id, version, content_hash, recorded_at, previous_hash):
    data = {
        "index": index,
        "poem_id": str(poem_id),
        "version": version,
        "content_hash": content_hash,
        "recorded_at": normalisasi_waktu(recorded_at),
        "previous_hash": previous_hash,
    }
    kanonis = json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(kanonis.encode("utf-8")).hexdigest()


def verifikasi(records):
    previous_hash = HASH_NOL
    expected_version = 1
    errors = []

    for record in records:
        poem_id, version, content_hash, stored_previous, stored_chain, recorded_at = record

        if version != expected_version:
            errors.append(
                f"Versi {version}: urutan terputus, seharusnya {expected_version}"
            )

        if stored_previous != previous_hash:
            errors.append(
                f"Versi {version}: previous_hash tidak cocok dengan versi sebelumnya"
            )

        calculated = hitung_hash(
            version, poem_id, version, content_hash, recorded_at, stored_previous
        )

        if calculated != stored_chain:
            errors.append(f"Versi {version}: chain_hash tidak cocok (data berubah)")

        previous_hash = stored_chain
        expected_version = version + 1

    return errors


def main():
    parser = argparse.ArgumentParser(description="Verifikasi integritas authorship chain")
    parser.add_argument("--poem-id", help="UUID puisi; kosongkan untuk semua puisi")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL belum dikonfigurasi")
        return 2

    try:
        with psycopg2.connect(database_url) as conn:
            with conn.cursor() as cur:
                if args.poem_id:
                    cur.execute(
                        """
                        SELECT poem_id, version, content_hash, previous_hash,
                               chain_hash, recorded_at
                        FROM authorship_records
                        WHERE poem_id = %s
                        ORDER BY version
                        """,
                        (args.poem_id,),
                    )
                else:
                    cur.execute(
                        """
                        SELECT poem_id, version, content_hash, previous_hash,
                               chain_hash, recorded_at
                        FROM authorship_records
                        ORDER BY poem_id, version
                        """
                    )
                records = cur.fetchall()

        if not records:
            print("TIDAK ADA CATATAN AUTHORSHIP")
            return 1

        grouped = {}
        for record in records:
            grouped.setdefault(str(record[0]), []).append(record)

        total_errors = 0
        for poem_id, poem_records in grouped.items():
            errors = verifikasi(poem_records)
            if errors:
                total_errors += len(errors)
                print(f"[GAGAL] {poem_id}")
                for error in errors:
                    print(f"  - {error}")
            else:
                print(f"[VALID] {poem_id}: {len(poem_records)} versi")

        if total_errors:
            print(f"\nVERIFIKASI GAGAL: {total_errors} masalah ditemukan")
            return 1

        print(f"\nVERIFIKASI BERHASIL: {len(grouped)} puisi valid")
        return 0

    except Exception as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
