#!/usr/bin/env bash
# Failover PostgreSQL manual (reliability poin kritis Database, D7).
# Mempromosikan postgres-replica menjadi primary saat `postgres` mati.
#
# Jalankan dari root repositori (Git Bash / Linux), dengan argumen compose yang
# sama seperti saat stack dinyalakan, mis.:
#   bash infra/postgres/failover.sh
#   COMPOSE="docker compose -p puisidb --env-file .env -f infra/docker-compose.yml" bash infra/postgres/failover.sh
#
# Urutan:
#   1. Hentikan dan hapus container primary lama (volume tetap ada), supaya
#      tidak hidup lagi dengan nama `postgres` dan menimbulkan split brain.
#   2. Catat posisi replika: event outbox yang dibuat setelah
#      (waktu replay terakhir - MARGIN_MENIT) mungkin belum sempat dikirim Debezium.
#   3. pg_promote() di replika.
#   4. Pindahkan alias jaringan `postgres` ke replika. Layanan tidak perlu
#      diubah atau di-restart: koneksi baru ke host `postgres` otomatis ke replika.
#   5. Reset offset Debezium (LSN lama tidak berlaku di server baru), lalu
#      nyalakan relay. Debezium membuat replication slot baru (snapshot no_data).
#   6. Kuras outbox sejak titik di langkah 2 dengan relay polling, menutup celah
#      antara event terakhir yang terkirim dan slot baru. Duplikat disaring
#      konsumen (processed_event).
#
# Replikasi asinkron: transaksi yang sudah commit di primary tetapi belum
# sampai ke replika saat primary mati HILANG (RPO = lag replikasi, biasanya < 1 dtk).
#
# Setelah failover JANGAN `docker compose up` service `postgres` begitu saja.
# Ikuti "Failback" di docs/runbook.md.
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"
MARGIN_MENIT="${MARGIN_MENIT:-10}"
c() { $COMPOSE "$@"; }
log() { printf '[failover %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
psql_replika() {
  # shellcheck disable=SC2016
  c exec -T postgres-replica sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -tAc "$1"' sh "$1"
}

replika_id="$(c ps -q postgres-replica)"
[ -n "$replika_id" ] || { echo "postgres-replica tidak berjalan" >&2; exit 1; }
[ "$(psql_replika 'SELECT pg_is_in_recovery()')" = "t" ] \
  || { echo "postgres-replica bukan standby (sudah dipromosikan?)" >&2; exit 1; }

# Hanya relay yang punya container di stack ini (berjalan atau berhenti); relay
# milik domain yang tidak dinyalakan tidak ikut dibuat.
relay=()
while IFS= read -r s; do relay+=("$s"); done < <(c ps -a --format '{{.Service}}' | grep '^outbox-relay-' | sort -u || true)

log "1. menghentikan primary lama"
c stop postgres >/dev/null 2>&1 || true
c rm -f postgres >/dev/null 2>&1 || true

log "2. mencatat posisi replay replika"
sejak="$(psql_replika "SELECT to_char((coalesce(pg_last_xact_replay_timestamp(), now()) - interval '${MARGIN_MENIT} minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")"
log "   event outbox sejak $sejak akan diterbitkan ulang"

log "3. promote replika"
psql_replika 'SELECT pg_promote(true, 60)' >/dev/null
[ "$(psql_replika 'SELECT pg_is_in_recovery()')" = "f" ] || { echo "promote gagal" >&2; exit 1; }

log "4. memindahkan alias jaringan 'postgres' ke replika"
jaringan="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$replika_id" | tr ' ' '\n' | grep '_data$' | head -1)"
[ -n "$jaringan" ] || { echo "jaringan *_data tidak ditemukan" >&2; exit 1; }
docker network disconnect "$jaringan" "$replika_id"
docker network connect --alias postgres --alias postgres-replica "$jaringan" "$replika_id"


log "5. reset offset dan nyalakan ulang ${#relay[@]} outbox-relay"
for s in "${relay[@]}"; do
  c stop "$s" >/dev/null 2>&1 || true
  c run --rm --no-deps -T --entrypoint sh "$s" -c 'rm -f /debezium/data/offsets.dat' >/dev/null
done
[ "${#relay[@]}" -eq 0 ] || c up -d --no-deps "${relay[@]}" >/dev/null

log "6. menguras outbox sejak $sejak"
pg_user="$(c exec -T postgres-replica sh -c 'printf %s "$POSTGRES_USER"')"
pg_pass="$(c exec -T postgres-replica sh -c 'printf %s "$POSTGRES_PASSWORD"')"
for s in "${relay[@]}"; do
  db="$(c config "$s" | sed -n 's/^ *RELAY_DB: *//p' | head -1)"
  [ -n "$db" ] || continue
  log "   $db"
  c run --rm --no-deps -T \
    -e DATABASE_URL="postgres://${pg_user}:${pg_pass}@postgres:5432/${db}" \
    -e RELAY_SEJAK="$sejak" -e RELAY_SEKALI=1 -e SERVICE_NAME="relay-kuras-${db}" \
    rabbitmq-topologi node bin/relay-polling.js
done

log "selesai: postgres-replica kini primary (alias 'postgres'). Lihat docs/runbook.md untuk failback."
