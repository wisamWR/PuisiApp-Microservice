-- notification-service (T2.8, kelompok 2): notif_db.
-- Notifikasi penulis dan pelapor. Hanya konsumen, tanpa outbox.
-- Tabel dibuat migrasi layanan (services/notification-service/migrations).

\getenv notification_db_pass NOTIFICATION_DB_PASS

CREATE ROLE notification LOGIN PASSWORD :'notification_db_pass';
CREATE DATABASE notif_db OWNER notification;
REVOKE ALL ON DATABASE notif_db FROM PUBLIC;
GRANT CONNECT ON DATABASE notif_db TO notification;
