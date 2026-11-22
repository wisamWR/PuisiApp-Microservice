-- Database register-service (T1.1, kelompok 1 Akun dan identitas).
-- Pola sama dengan 01-example.sql. Password dibaca dari REGISTER_DB_PASS di .env.
-- Tabel accounts dan tabel outbox dibuat oleh migrasi layanan, bukan di sini.

\getenv register_db_pass REGISTER_DB_PASS

CREATE ROLE register LOGIN PASSWORD :'register_db_pass';
CREATE DATABASE account_db OWNER register;
REVOKE ALL ON DATABASE account_db FROM PUBLIC;
GRANT CONNECT ON DATABASE account_db TO register;

-- ---------------------------------------------------------------- OUTBOX
-- outbox-relay (user debezium) membaca database ini lewat logical replication.
-- pemilik = user layanan; slot = RELAY_SLOT di compose identity (outbox_account).
GRANT CONNECT ON DATABASE account_db TO debezium;
\connect account_db
\set pemilik register
\set slot outbox_account
\ir _outbox.psql
