-- Database login-service (T1.2, kelompok 1 Akun dan identitas).
-- Pola sama dengan 10-register.sql. Password dari LOGIN_DB_PASS di .env.
-- Tabel credentials dan login_attempts dibuat oleh migrasi layanan.
-- login-service tidak menerbitkan event, jadi tidak perlu outbox dan relay.

\getenv login_db_pass LOGIN_DB_PASS

CREATE ROLE login_svc LOGIN PASSWORD :'login_db_pass';
CREATE DATABASE credential_db OWNER login_svc;
REVOKE ALL ON DATABASE credential_db FROM PUBLIC;
GRANT CONNECT ON DATABASE credential_db TO login_svc;
