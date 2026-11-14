-- Akun pengguna. Hanya register-service yang menulis tabel ini.
-- Layanan lain menerima data akun lewat event user.registered, tidak membaca tabel ini.
CREATE TABLE IF NOT EXISTS accounts (
  id             UUID PRIMARY KEY,
  username       TEXT NOT NULL,
  email          TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'writer',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_username_key UNIQUE (username),
  CONSTRAINT accounts_email_key UNIQUE (email)
);
