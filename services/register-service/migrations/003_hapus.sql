-- Penanda akun dihapus (T1.7). Akun yang sudah dihapus tidak bisa masuk dan tidak muncul di pencarian.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS dihapus_pada TIMESTAMPTZ NULL;
