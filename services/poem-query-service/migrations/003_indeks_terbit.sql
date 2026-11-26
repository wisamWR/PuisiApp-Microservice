-- T3.1 / T2.3: indeks untuk daftar publik puisi PUBLISHED urut terbaru (GET /api/poems tanpa author).
-- Ekspresi dan arah urutan menyamai ORDER BY di repo.daftarPenulis.
CREATE INDEX IF NOT EXISTS poem_terbit_idx
  ON poem ((COALESCE(published_at, dikirim_at)) DESC NULLS LAST, poem_id)
  WHERE status = 'PUBLISHED';
