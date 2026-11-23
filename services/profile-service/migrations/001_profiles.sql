-- Profil publik pengguna. Hanya profile-service yang menulis tabel ini.
-- version naik setiap perubahan dan dipakai sebagai aggregate_version event user.profile.updated.
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
