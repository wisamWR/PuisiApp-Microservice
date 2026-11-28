#!/bin/sh
# Entrypoint postgres-replica (D4): hot standby dari primary lewat streaming replication.
#
# Volume kosong -> salin primary dengan pg_basebackup memakai slot `replika_1`
# (dibuat init/02-replikasi.sh). Opsi -R menulis standby.signal dan
# primary_conninfo, sehingga server langsung berjalan sebagai standby.
# Volume sudah berisi -> langsung start (melanjutkan streaming dari posisi terakhir).
#
# Membangun ulang replika (mis. setelah slot di-invalidate karena replika mati
# terlalu lama): docker compose rm -sf postgres-replica, hapus volume
# <proyek>_pg-replica-data, lalu docker compose up -d postgres-replica.
set -eu

: "${REPLICATION_DB_PASS:?isi REPLICATION_DB_PASS di .env}"
PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  echo "replika: menyalin data dari $PRIMARY_HOST:$PRIMARY_PORT"
  until su-exec postgres env PGPASSWORD="$REPLICATION_DB_PASS" pg_basebackup \
      -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U replicator \
      -D "$PGDATA" -S replika_1 -R -X stream -c fast; do
    echo "replika: primary belum siap, mencoba lagi dalam 3 detik"
    rm -rf "${PGDATA:?}"/*
    sleep 3
  done
fi

# Nilai max_* wajib >= primary agar hot standby mau start (lihat docker-compose.yml).
# wal_level=logical dan max_slot_wal_keep_size disamakan dengan primary supaya
# setelah dipromosikan (infra/postgres/failover.sh) outbox-relay Debezium bisa
# langsung membuat replication slot logis di sini.
exec docker-entrypoint.sh postgres \
  -c hot_standby=on \
  -c hot_standby_feedback=on \
  -c wal_level=logical \
  -c max_wal_senders=20 \
  -c max_replication_slots=20 \
  -c max_slot_wal_keep_size=1024MB
