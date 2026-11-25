-- T2.8: alasan dari poem.held / poem.hidden untuk halaman Puisi Saya.
-- NULL untuk status lain (dikosongkan lagi saat puisi terbit).
ALTER TABLE poem ADD COLUMN IF NOT EXISTS alasan_status TEXT;
