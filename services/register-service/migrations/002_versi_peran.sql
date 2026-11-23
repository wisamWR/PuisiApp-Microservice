-- Versi akun untuk aggregate_version event user.role.changed (T1.7). Naik setiap perubahan peran.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
