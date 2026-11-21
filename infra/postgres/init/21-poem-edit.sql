-- poem-edit-service (T2.4, kelompok 2): revision_db.
-- Revisi puisi (append-only) + salinan kepemilikan + outbox poem.revised.
-- Tabel dibuat migrasi layanan (services/poem-edit-service/migrations).

\getenv poem_edit_db_pass POEM_EDIT_DB_PASS

CREATE ROLE poem_edit LOGIN PASSWORD :'poem_edit_db_pass';
CREATE DATABASE revision_db OWNER poem_edit;
REVOKE ALL ON DATABASE revision_db FROM PUBLIC;
GRANT CONNECT ON DATABASE revision_db TO poem_edit;

-- ---------------------------------------------------------------- OUTBOX
GRANT CONNECT ON DATABASE revision_db TO debezium;
\connect revision_db
\set pemilik poem_edit
\set slot outbox_revision
\ir _outbox.psql
