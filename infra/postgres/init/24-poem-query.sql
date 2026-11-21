-- poem-query-service (T2.3, kelompok 2): poem_read_db.
-- Read model puisi (CQRS). Hanya konsumen, tidak menerbitkan event: tanpa outbox.
-- Tabel dibuat migrasi layanan (services/poem-query-service/migrations).

\getenv poem_query_db_pass POEM_QUERY_DB_PASS

CREATE ROLE poem_query LOGIN PASSWORD :'poem_query_db_pass';
CREATE DATABASE poem_read_db OWNER poem_query;
REVOKE ALL ON DATABASE poem_read_db FROM PUBLIC;
GRANT CONNECT ON DATABASE poem_read_db TO poem_query;
