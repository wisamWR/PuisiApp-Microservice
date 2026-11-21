-- poem_read_db (poem-query-service, T2.3). Read model hasil proyeksi event (CQRS).
-- Setiap event hanya mengisi kolomnya sendiri, sehingga urutan kedatangan event
-- dari layanan berbeda tidak penting. Tabel processed_event dari migrasi standar.

-- Satu baris per puisi: kepemilikan, status publikasi, versi, skor suara.
CREATE TABLE IF NOT EXISTS poem (
  poem_id        UUID         PRIMARY KEY,
  author_id      VARCHAR(64),                -- NULL bila event status tiba sebelum poem.submitted
  -- Dari publication-service (PUBLISHED/HELD/HIDDEN), poem.submitted (PROCESSING), poem.deleted.
  status         VARCHAR(16)  CHECK (status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN', 'DELETED')),
  status_at      TIMESTAMPTZ,                -- occurred_at event status terakhir (event lebih lama diabaikan)
  versi_terbaru  INT          NOT NULL DEFAULT 1,
  versi_tampil   INT,                        -- versi yang terbit; tetap selama revisi dinilai
  dikirim_at     TIMESTAMPTZ,                -- submitted_at versi 1
  published_at   TIMESTAMPTZ,
  skor           INT          NOT NULL DEFAULT 0,
  jumlah_suara   INT          NOT NULL DEFAULT 0,
  skor_at        TIMESTAMPTZ,                -- updated_at poem.score.updated terakhir
  diubah_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poem_penulis_idx ON poem (author_id, (COALESCE(published_at, dikirim_at)) DESC);

-- Satu baris per versi puisi: teks dan hasil analisis versi itu.
CREATE TABLE IF NOT EXISTS poem_versi (
  poem_id          UUID          NOT NULL,
  versi            INT           NOT NULL CHECK (versi >= 1),
  judul            VARCHAR(150),
  isi              TEXT,
  indeks_bait      SMALLINT,
  bait_kutipan     VARCHAR(280),
  template         VARCHAR(20),
  kategori         VARCHAR(60),
  tag              TEXT[],                   -- kata kunci dari penulis
  dikirim_at       TIMESTAMPTZ,              -- submitted_at / revised_at
  gambar_url       TEXT,                     -- poem.image.rendered
  gambar_lebar     INT,
  gambar_tinggi    INT,
  kata_kunci       TEXT[],                   -- poem.keywords.extracted
  tema             TEXT[],                   -- poem.themes.extracted
  emosi            JSONB,                    -- poem.emotion.analyzed: [{line_number, label, score}]
  level_kemiripan  VARCHAR(32),              -- poem.similarity.scored
  skor_kemiripan   NUMERIC(5, 4),
  diubah_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (poem_id, versi)
);

-- Salinan nama penulis dari kelompok 1 (user.registered, user.profile.updated).
CREATE TABLE IF NOT EXISTS penulis (
  user_id       VARCHAR(64)   PRIMARY KEY,
  username      VARCHAR(50),
  display_name  VARCHAR(100),
  bio           VARCHAR(500),
  profil_at     TIMESTAMPTZ,                 -- occurred_at user.profile.updated terakhir
  diubah_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
