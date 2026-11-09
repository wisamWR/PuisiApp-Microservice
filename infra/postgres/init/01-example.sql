-- Contoh layanan (services/example-consumer, T0.2).
-- Pola ini disalin setiap kelompok untuk layanannya sendiri:
--   1. ganti "example" dengan nama layanan,
--   2. tambahkan <LAYANAN>_DB_PASS ke .env.example,
--   3. simpan sebagai NN-<layanan>.sql (NN mengikuti nomor kelompok, lihat README).
--
-- Password dibaca dari variabel lingkungan container postgres (\getenv, psql 15+).
-- Bila variabel tidak ada, :'pw' tidak terdefinisi dan skrip gagal dengan jelas.
-- Tabel (termasuk outbox dan processed_event) dibuat oleh migrasi layanan,
-- bukan di sini.

\getenv example_db_pass EXAMPLE_DB_PASS

CREATE ROLE example LOGIN PASSWORD :'example_db_pass';
CREATE DATABASE example_db OWNER example;
REVOKE ALL ON DATABASE example_db FROM PUBLIC;
GRANT CONNECT ON DATABASE example_db TO example;
