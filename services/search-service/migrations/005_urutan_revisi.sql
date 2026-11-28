-- Perbaikan urutan event dan revisi (review PR #28).
-- status_at   : event status yang lebih lama tidak menimpa yang lebih baru.
-- versi_terbit: versi terakhir yang dipublikasikan (aggregate_version poem.published).
-- *_baru      : revisi yang belum dipublikasikan. Isi lama tetap dicari sampai revisi terbit.
ALTER TABLE poem_cari ALTER COLUMN author_id SET DEFAULT '';
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS status_at    timestamptz;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS versi_terbit integer;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS judul_baru   text;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS isi_baru     text;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS bait_baru    text;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS indeks_baru  integer;
ALTER TABLE poem_cari ADD COLUMN IF NOT EXISTS versi_baru   integer;

ALTER TABLE poem_cari DROP CONSTRAINT IF EXISTS poem_cari_status_check;
ALTER TABLE poem_cari ADD CONSTRAINT poem_cari_status_check
  CHECK (status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN', 'DELETED'));
