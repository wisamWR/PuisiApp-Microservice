-- vote-persist-worker (T9.2, kelompok 9): vote_db.
-- Penyimpanan permanen suara (write-behind dari Redis lewat vote.cast).
-- Hanya konsumen, tidak menerbitkan event: tanpa outbox.
-- Tabel dibuat migrasi layanan (services/vote-persist-worker/migrations).

\getenv vote_db_pass VOTE_DB_PASS

CREATE ROLE vote LOGIN PASSWORD :'vote_db_pass';
CREATE DATABASE vote_db OWNER vote;
REVOKE ALL ON DATABASE vote_db FROM PUBLIC;
GRANT CONNECT ON DATABASE vote_db TO vote;
