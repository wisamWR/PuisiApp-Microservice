-- Database profile-service (T1.5, kelompok 1 Akun dan identitas).
-- Pola sama dengan 10-register.sql. Password dari PROFILE_DB_PASS di .env.
-- Tabel profiles dan outbox dibuat oleh migrasi layanan. Relay outbox membaca profile_db (T0.3).

\getenv profile_db_pass PROFILE_DB_PASS

CREATE ROLE profile_svc LOGIN PASSWORD :'profile_db_pass';
CREATE DATABASE profile_db OWNER profile_svc;
REVOKE ALL ON DATABASE profile_db FROM PUBLIC;
GRANT CONNECT ON DATABASE profile_db TO profile_svc;

-- ---------------------------------------------------------------- OUTBOX
GRANT CONNECT ON DATABASE profile_db TO debezium;
\connect profile_db
\set pemilik profile_svc
\set slot outbox_profile
\ir _outbox.psql
