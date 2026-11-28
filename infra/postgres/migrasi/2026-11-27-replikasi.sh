#!/bin/sh
# Migrasi manual untuk volume PostgreSQL yang dibuat SEBELUM
# init/02-replikasi.sh ditambahkan (27 November 2026). Volume baru tidak
# memerlukan ini. Idempoten: aman dijalankan ulang.
#
# Jalankan sekali dari root repositori (Git Bash):
#   MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh -s < infra/postgres/migrasi/2026-11-27-replikasi.sh
# lalu nyalakan replika:
#   docker compose up -d postgres-replica
set -eu

: "${REPLICATION_DB_PASS:?isi REPLICATION_DB_PASS di .env lalu recreate container postgres}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v pass="$REPLICATION_DB_PASS" <<'SQL'
SELECT 'CREATE ROLE replicator LOGIN REPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') \gexec
ALTER ROLE replicator PASSWORD :'pass';
SELECT pg_create_physical_replication_slot('replika_1')
WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'replika_1');
SQL

grep -q '^host replication replicator' "$PGDATA/pg_hba.conf" \
  || echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
psql --username "$POSTGRES_USER" --dbname postgres -c 'SELECT pg_reload_conf();'
