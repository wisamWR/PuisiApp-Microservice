-- Database account-recovery-service (T1.6, kelompok 1 Akun dan identitas).
-- Password dibaca dari RECOVERY_DB_PASS di .env.

\getenv recovery_db_pass RECOVERY_DB_PASS

CREATE ROLE recovery_svc LOGIN PASSWORD :'recovery_db_pass';
CREATE DATABASE recovery_db OWNER recovery_svc;
REVOKE ALL ON DATABASE recovery_db FROM PUBLIC;
GRANT CONNECT ON DATABASE recovery_db TO recovery_svc;

GRANT CONNECT ON DATABASE recovery_db TO debezium;
\connect recovery_db
\set pemilik recovery_svc
\set slot outbox_recovery
\ir _outbox.psql
