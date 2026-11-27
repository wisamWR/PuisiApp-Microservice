-- Database khusus bookmark-service (T3.4, Kelompok 3).
-- Hanya konsumen event (poem.*, user.deleted), tidak menerbitkan event: tanpa outbox.
-- Tabel dibuat migrasi layanan (services/bookmark-service/migrations).

\getenv bookmark_db_pass BOOKMARK_DB_PASS

CREATE ROLE bookmark LOGIN PASSWORD :'bookmark_db_pass';
CREATE DATABASE bookmark_db OWNER bookmark;
REVOKE ALL ON DATABASE bookmark_db FROM PUBLIC;
GRANT CONNECT ON DATABASE bookmark_db TO bookmark;
