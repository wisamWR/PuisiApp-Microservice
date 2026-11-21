-- poem-delete-service (T2.4, kelompok 2): deletion_db.
-- Penghapusan lunak + salinan kepemilikan + outbox poem.deleted.
-- Tabel dibuat migrasi layanan (services/poem-delete-service/migrations).

\getenv poem_delete_db_pass POEM_DELETE_DB_PASS

CREATE ROLE poem_delete LOGIN PASSWORD :'poem_delete_db_pass';
CREATE DATABASE deletion_db OWNER poem_delete;
REVOKE ALL ON DATABASE deletion_db FROM PUBLIC;
GRANT CONNECT ON DATABASE deletion_db TO poem_delete;

-- ---------------------------------------------------------------- OUTBOX
GRANT CONNECT ON DATABASE deletion_db TO debezium;
\connect deletion_db
\set pemilik poem_delete
\set slot outbox_deletion
\ir _outbox.psql
