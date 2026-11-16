-- Contoh layanan (services/example-consumer, T0.2 dan T0.3).
-- Pola ini disalin setiap kelompok untuk layanannya sendiri:
--   1. ganti "example" dengan nama layanan,
--   2. tambahkan <LAYANAN>_DB_PASS ke .env.example,
--   3. simpan sebagai NN-<layanan>.sql (NN mengikuti nomor kelompok, lihat infra/README.md),
--   4. bagian OUTBOX hanya untuk database yang menerbitkan event lewat outbox.
--
-- Password dibaca dari variabel lingkungan container postgres (\getenv, psql 15+).
-- Bila variabel tidak ada, :'pw' tidak terdefinisi dan skrip gagal dengan jelas.
-- Tabel bisnis dan processed_event dibuat oleh migrasi layanan, bukan di sini.

\getenv example_db_pass EXAMPLE_DB_PASS

CREATE ROLE example LOGIN PASSWORD :'example_db_pass';
CREATE DATABASE example_db OWNER example;
REVOKE ALL ON DATABASE example_db FROM PUBLIC;
GRANT CONNECT ON DATABASE example_db TO example;

-- ---------------------------------------------------------------- OUTBOX
-- outbox-relay (user debezium) membaca database ini lewat logical replication.
-- pemilik = user layanan; slot = RELAY_SLOT di compose relay (outbox_<layanan>).
GRANT CONNECT ON DATABASE example_db TO debezium;
\connect example_db
\set pemilik example
\set slot outbox_example
\ir _outbox.psql
