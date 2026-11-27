-- Bookmark puisi (T3.4). Satu pengguna satu bookmark per puisi.
CREATE TABLE IF NOT EXISTS bookmark (
  user_id     TEXT NOT NULL,
  poem_id     UUID NOT NULL,
  dibuat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, poem_id)
);
CREATE INDEX IF NOT EXISTS bookmark_user_waktu_idx ON bookmark (user_id, dibuat_at DESC);
CREATE INDEX IF NOT EXISTS bookmark_poem_idx ON bookmark (poem_id);

-- Salinan ringkas puisi dari event, untuk judul dan kutipan di daftar Simpanan
-- serta menyaring puisi yang ditahan, disembunyikan, atau dihapus.
CREATE TABLE IF NOT EXISTS puisi_simpan (
  poem_id       UUID PRIMARY KEY,
  judul         TEXT,
  kutipan       TEXT,
  versi         INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'PROCESSING'
                CHECK (status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN', 'DELETED')),
  status_at     TIMESTAMPTZ,
  diubah_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
