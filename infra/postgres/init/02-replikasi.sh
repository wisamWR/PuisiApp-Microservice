#!/bin/sh
# Streaming replication untuk standby baca (reliability, poin kritis Database / D3).
#
# Membuat:
#   - role `replicator` (LOGIN REPLICATION), password dari REPLICATION_DB_PASS
#   - physical replication slot `replika_1`, supaya WAL yang belum diterima
#     replika tidak dibuang primary. Batasnya tetap max_slot_wal_keep_size
#     (1024MB, lihat docker-compose.yml), jadi replika yang mati lama tidak
#     memenuhi disk; replika seperti itu harus dibangun ulang.
#   - aturan pg_hba untuk koneksi replikasi fisik. Kata kunci `all` di pg_hba
#     bawaan image tidak mencakup koneksi replikasi fisik (butuh `replication`).
#
# Skrip init hanya jalan saat volume masih kosong. Untuk volume lama, lihat
# infra/postgres/migrasi/2026-11-27-replikasi.sh.
set -eu

: "${REPLICATION_DB_PASS:?isi REPLICATION_DB_PASS di .env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v pass="$REPLICATION_DB_PASS" <<'SQL'
CREATE ROLE replicator LOGIN REPLICATION PASSWORD :'pass';
SELECT pg_create_physical_replication_slot('replika_1');
SQL

echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
