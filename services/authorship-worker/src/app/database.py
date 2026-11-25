import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

from app.hash_chain import HASH_NOL, buat_catatan

FOLDER_MIGRASI = Path(__file__).resolve().parents[2] / "migrations"
KUNCI_ADVISORY = 734_215_007


def get_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL belum dikonfigurasi")
    return psycopg2.connect(database_url)


def jalankan_migrasi(conn, folder: Path = FOLDER_MIGRASI) -> list[str]:
    dijalankan = []
    conn.autocommit = True

    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (KUNCI_ADVISORY,))

    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrasi (
                    nama TEXT PRIMARY KEY,
                    dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
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


def versi_tersimpan(event: dict, cur) -> int:
    cur.execute(
        """
        SELECT COALESCE(MAX(version), 0)
        FROM authorship_records
        WHERE poem_id = %s
        """,
        (event["aggregate_id"],),
    )
    return cur.fetchone()[0]


def simpan_catatan(event: dict, cur) -> dict:
    payload = event["payload"]
    poem_id = str(payload["poem_id"])
    version = int(payload["version"])
    body = payload["body"]

    if version != int(event["aggregate_version"]):
        raise ValueError("Versi payload tidak sesuai dengan aggregate_version")

    terakhir = versi_tersimpan(event, cur)

    if terakhir != version - 1:
        raise RuntimeError(
            f"Urutan versi belum lengkap: versi terakhir={terakhir}, "
            f"versi masuk={version}"
        )

    previous_hash = HASH_NOL

    if version > 1:
        cur.execute(
            """
            SELECT chain_hash
            FROM authorship_records
            WHERE poem_id = %s AND version = %s
            """,
            (poem_id, version - 1),
        )
        sebelumnya = cur.fetchone()
        if sebelumnya is None:
            raise RuntimeError("Catatan versi sebelumnya belum ditemukan")
        previous_hash = sebelumnya[0]

    recorded_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    catatan = buat_catatan(
        poem_id=poem_id,
        version=version,
        body=body,
        recorded_at=recorded_at,
        previous_hash=previous_hash,
    )

    cur.execute(
        """
        INSERT INTO authorship_records (
            poem_id, version, content_hash, previous_hash,
            chain_hash, recorded_at, source_event_id
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            poem_id,
            version,
            catatan["content_hash"],
            catatan["previous_hash"],
            catatan["chain_hash"],
            catatan["recorded_at"],
            event["event_id"],
        ),
    )

    return catatan
