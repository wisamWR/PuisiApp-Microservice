-- Salinan kredensial dari event user.registered. Tabel ini milik login-service.
-- Tidak pernah dibaca layanan lain, dan tidak diisi lewat jalur sinkron.
CREATE TABLE IF NOT EXISTS credentials (
  id             UUID PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'writer',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Penghitung kegagalan login per username (penundaan, T1.2 butir 7).
CREATE TABLE IF NOT EXISTS login_attempts (
  username        TEXT PRIMARY KEY,
  gagal           INTEGER NOT NULL DEFAULT 0,
  jendela_mulai   TIMESTAMPTZ NOT NULL DEFAULT now()
);
