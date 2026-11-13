-- revision_db (poem-edit-service). Sesuai Listing A.3 laporan.

-- Salinan kepemilikan dari poem.submitted / poem.deleted (event-carried state
-- transfer): pemeriksaan pemilik tanpa memanggil layanan lain.
CREATE TABLE IF NOT EXISTS poem_ownership (
  poem_id        UUID        PRIMARY KEY,
  author_id      VARCHAR(64) NOT NULL,
  deleted        BOOLEAN     NOT NULL DEFAULT false,
  versi_terakhir INT         NOT NULL DEFAULT 1
);

-- Append-only: setiap revisi adalah versi baru, versi lama tidak pernah diubah.
CREATE TABLE IF NOT EXISTS revision (
  poem_id         UUID         NOT NULL,
  versi           INT          NOT NULL CHECK (versi >= 2),
  author_id       VARCHAR(64)  NOT NULL,
  judul           VARCHAR(150) NOT NULL,
  isi             TEXT         NOT NULL CHECK (length(isi) <= 8000),
  bait_kutipan    VARCHAR(280) NOT NULL,
  indeks_bait     SMALLINT     NOT NULL CHECK (indeks_bait >= 0),
  template        VARCHAR(20)  NOT NULL,
  kategori        VARCHAR(60),
  keyword_manual  TEXT[]       NOT NULL DEFAULT '{}',
  idempotency_key VARCHAR(64)  NOT NULL,
  request_hash    CHAR(64)     NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (poem_id, versi),
  UNIQUE (poem_id, idempotency_key)              -- kirim ulang tidak membuat versi ganda
);
