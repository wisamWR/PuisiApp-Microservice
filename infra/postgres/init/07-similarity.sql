\getenv similarity_db_pass SIMILARITY_DB_PASS

CREATE ROLE similarity LOGIN PASSWORD :'similarity_db_pass';
CREATE DATABASE similarity_db OWNER similarity;
REVOKE ALL ON DATABASE similarity_db FROM PUBLIC;
GRANT CONNECT ON DATABASE similarity_db TO similarity;

GRANT CONNECT ON DATABASE similarity_db TO debezium;
\connect similarity_db

\set pemilik similarity
\set slot outbox_similarity
\ir _outbox.psql
