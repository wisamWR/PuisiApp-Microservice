-- Migrasi manual untuk volume PostgreSQL yang dibuat SEBELUM tabel
-- debezium_heartbeat ditambahkan ke _outbox.psql (10 November 2026).
-- Volume baru tidak memerlukan ini.
--
-- Jalankan sekali per database ber-outbox, sebagai superuser:
--   MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -U postgres -d example_db -v pemilik=example -f /dev/stdin < infra/postgres/migrasi/2026-11-10-heartbeat-outbox.sql
-- (ganti example_db / example dengan database dan user pemiliknya)

CREATE TABLE IF NOT EXISTS debezium_heartbeat (
  id SMALLINT    PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL
);
ALTER TABLE debezium_heartbeat OWNER TO :"pemilik";
GRANT SELECT, INSERT, UPDATE ON debezium_heartbeat TO debezium;
ALTER PUBLICATION outbox_pub ADD TABLE debezium_heartbeat;
ALTER PUBLICATION outbox_pub SET (publish = 'insert, update');
