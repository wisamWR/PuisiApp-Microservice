-- Read model pencarian (T3.2). Diisi dari event, bukan dari poem_read_db.
-- Konfigurasi 'simple' karena PostgreSQL bawaan tidak punya konfigurasi bahasa Indonesia.
-- Konsekuensi: kata berimbuhan tidak cocok otomatis (mis. "hujan" tidak cocok "hujannya").

CREATE TABLE IF NOT EXISTS poem_cari (
  poem_id        UUID PRIMARY KEY,
  author_id      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'HIDDEN', 'DELETED')),
  judul          TEXT NOT NULL DEFAULT '',
  isi            TEXT NOT NULL DEFAULT '',
  kata_kunci     TEXT NOT NULL DEFAULT '',
  published_at   TIMESTAMPTZ,
  versi          INT NOT NULL DEFAULT 1,
  vektor         TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(judul, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(kata_kunci, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(isi, '')), 'C')
  ) STORED,
  diubah_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poem_cari_vektor_idx ON poem_cari USING GIN (vektor);
CREATE INDEX IF NOT EXISTS poem_cari_author_idx ON poem_cari (author_id);

CREATE TABLE IF NOT EXISTS penulis_cari (
  user_id        TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL DEFAULT '',
  jumlah_puisi   INT NOT NULL DEFAULT 0 CHECK (jumlah_puisi >= 0),
  vektor         TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(display_name, ''))
  ) STORED,
  diubah_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS penulis_cari_vektor_idx ON penulis_cari USING GIN (vektor);
