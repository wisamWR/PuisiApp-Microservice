-- publication-service (T2.2, kelompok 2): publication_db.
-- Status publikasi per puisi + outbox poem.published / poem.held / poem.hidden.
-- Tabel dibuat migrasi layanan (services/publication-service/migrations).

\getenv publication_db_pass PUBLICATION_DB_PASS

CREATE ROLE publication LOGIN PASSWORD :'publication_db_pass';
CREATE DATABASE publication_db OWNER publication;
REVOKE ALL ON DATABASE publication_db FROM PUBLIC;
GRANT CONNECT ON DATABASE publication_db TO publication;

-- ---------------------------------------------------------------- OUTBOX
GRANT CONNECT ON DATABASE publication_db TO debezium;
\connect publication_db
\set pemilik publication
\set slot outbox_publication
\ir _outbox.psql
