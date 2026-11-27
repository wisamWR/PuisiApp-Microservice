
-- Database khusus comment-service.
-- Database ini menyimpan komentar dan transactional outbox.

\getenv comment_db_pass COMMENT_DB_PASS

CREATE ROLE comment LOGIN PASSWORD :'comment_db_pass';
CREATE DATABASE comment_db OWNER comment;
REVOKE ALL ON DATABASE comment_db FROM PUBLIC;
GRANT CONNECT ON DATABASE comment_db TO comment;

-- --------------------------------------------------------------- OUTBOX
-- Outbox relay membaca event dari database comment_db.
GRANT CONNECT ON DATABASE comment_db TO debezium;
\connect comment_db
\set pemilik comment
\set slot outbox_comment
\ir _outbox.psql
