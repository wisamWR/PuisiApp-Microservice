-- Status PROCESSING dipakai saat poem.submitted masuk, sebelum publikasi.
ALTER TABLE poem_cari DROP CONSTRAINT IF EXISTS poem_cari_status_check;
ALTER TABLE poem_cari ADD CONSTRAINT poem_cari_status_check
  CHECK (status IN ('PROCESSING', 'PUBLISHED', 'HIDDEN', 'DELETED'));
