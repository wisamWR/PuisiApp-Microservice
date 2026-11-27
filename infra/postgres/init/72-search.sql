-- Database khusus search-service (T3.2, Kelompok 3).
-- Search tidak menerbitkan event, jadi tidak ada outbox. Hanya konsumen.
-- Kolom tsvector diisi dari event poem.* dan user.profile.updated.

\getenv search_db_pass SEARCH_DB_PASS

CREATE ROLE search LOGIN PASSWORD :'search_db_pass';
CREATE DATABASE search_db OWNER search;
REVOKE ALL ON DATABASE search_db FROM PUBLIC;
GRANT CONNECT ON DATABASE search_db TO search;
