-- poem-create-service (T2.1, kelompok 2): submission_db.
-- Menyimpan pengajuan puisi versi 1 + outbox poem.submitted.
-- Tabel submission dibuat migrasi layanan (services/poem-create-service/migrations).

\getenv poem_create_db_pass POEM_CREATE_DB_PASS

CREATE ROLE poem_create LOGIN PASSWORD :'poem_create_db_pass';
CREATE DATABASE submission_db OWNER poem_create;
REVOKE ALL ON DATABASE submission_db FROM PUBLIC;
GRANT CONNECT ON DATABASE submission_db TO poem_create;

-- ---------------------------------------------------------------- OUTBOX
GRANT CONNECT ON DATABASE submission_db TO debezium;
\connect submission_db
\set pemilik poem_create
\set slot outbox_submission
\ir _outbox.psql
