-- Database email-worker (T1.6, kelompok 1 Akun dan identitas).
-- Password dibaca dari EMAIL_WORKER_DB_PASS di .env.

\getenv email_worker_db_pass EMAIL_WORKER_DB_PASS

CREATE ROLE email_worker LOGIN PASSWORD :'email_worker_db_pass';
CREATE DATABASE email_worker_db OWNER email_worker;
REVOKE ALL ON DATABASE email_worker_db FROM PUBLIC;
GRANT CONNECT ON DATABASE email_worker_db TO email_worker;
