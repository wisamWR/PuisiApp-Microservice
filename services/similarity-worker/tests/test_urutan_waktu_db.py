"""Uji dengan PostgreSQL asli: aturan urutan waktu (first_seen_at).

Skenario dari review T7.2: puisi A v1 diunggah, B menyalin A, lalu A merevisi
ke v2. Penyalin (B) harus terdeteksi dugaan jiplakan, tetapi revisi A tidak
boleh ditandai jiplakan terhadap B, karena A tercatat lebih dulu.

Dilewati bila TEST_DATABASE_URL kosong. Contoh (stack dev, superuser):
  TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/similarity_uji
Basis data dibuat otomatis; tabel outbox dibuat di sini (di stack asli dibuat
infra/postgres/init/70-similarity.sql).
"""

import os
import random
import time
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

import psycopg2
import pytest

from app.database import jalankan_migrasi
from app.handler import handle_fingerprint

URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL kosong")

OUTBOX = """
CREATE TABLE IF NOT EXISTS outbox (
  event_id       UUID         PRIMARY KEY,
  aggregate_type VARCHAR(40)  NOT NULL,
  aggregate_id   VARCHAR(64)  NOT NULL,
  event_type     VARCHAR(80)  NOT NULL,
  payload        JSONB        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
)"""


@pytest.fixture(scope="module")
def conn():
    nama = urlparse(URL).path.lstrip("/")
    admin = psycopg2.connect(URL.replace(f"/{nama}", "/postgres"))
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (nama,))
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{nama}"')
    admin.close()

    c = psycopg2.connect(URL)
    with c, c.cursor() as cur:
        cur.execute(OUTBOX)
    jalankan_migrasi(c)
    with c, c.cursor() as cur:
        cur.execute(
            "TRUNCATE outbox, lsh_buckets, poem_signatures, poem_first_seen, "
            "processed_event CASCADE"
        )
    yield c
    c.close()


def tanda_tangan(seed: int) -> list[int]:
    rng = random.Random(seed)
    return [rng.getrandbits(32) for _ in range(128)]


def event_fingerprint(poem_id: str, versi: int, signature: list[int], shingle: int = 40) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "event_type": "poem.fingerprint.created",
        "schema_version": 1,
        "occurred_at": datetime.now(UTC).isoformat(),
        "producer": "fingerprint-worker",
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "aggregate_id": poem_id,
        "aggregate_version": versi,
        "payload": {
            "poem_id": poem_id,
            "version": versi,
            "shingle_count": shingle,
            "signature": signature,
            "stanza_signatures": [{"stanza": 1, "shingle_count": shingle, "signature": signature}],
        },
    }


def proses(conn, event: dict) -> dict:
    """Jalankan handler seperti konsumen (satu transaksi), kembalikan payload skor."""
    with conn, conn.cursor() as cur:
        handle_fingerprint(event, cur)
        cur.execute(
            "SELECT payload FROM outbox WHERE aggregate_id = %s ORDER BY created_at DESC LIMIT 1",
            (event["aggregate_id"],),
        )
        amplop = cur.fetchone()[0]
    assert amplop["aggregate_version"] == event["aggregate_version"]
    time.sleep(0.02)  # first_seen_at berbeda jelas antartransaksi
    return amplop["payload"]


def test_revisi_puisi_asli_tidak_ditandai_jiplakan_oleh_penyalin(conn):
    a = str(uuid.uuid4())
    b = str(uuid.uuid4())
    asli = tanda_tangan(1)

    skor_a1 = proses(conn, event_fingerprint(a, 1, asli))
    assert skor_a1["level"] == "original", "puisi pertama tidak punya pembanding"

    skor_b = proses(conn, event_fingerprint(b, 1, list(asli)))  # salinan utuh A
    assert skor_b["level"] == "suspected_plagiarism"
    assert skor_b["comparisons"][0]["compared_poem_id"] == a

    revisi = list(asli)
    for i in range(0, 128, 16):  # ubah sedikit: Jaccard tetap tinggi terhadap B
        revisi[i] ^= 0xFFFF
    skor_a2 = proses(conn, event_fingerprint(a, 2, revisi))
    assert skor_a2["level"] == "original", f"revisi A ditandai {skor_a2['level']}"
    assert all(c["compared_poem_id"] != b for c in skor_a2["comparisons"])


def test_versi_lain_dari_puisi_yang_sama_tidak_jadi_pembanding(conn):
    a = str(uuid.uuid4())
    sig = tanda_tangan(2)
    proses(conn, event_fingerprint(a, 1, sig))
    skor = proses(conn, event_fingerprint(a, 2, list(sig)))
    assert skor["level"] == "original"
    assert skor["comparisons"] == []
