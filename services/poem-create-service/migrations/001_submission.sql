-- submission_db (poem-create-service). Sesuai Listing A.3 laporan, dengan
-- tambahan indeks_bait (pilihan bait kutipan) dan request_hash (idempotensi).
-- Append-only: puisi versi 1 tidak pernah diubah di sini; revisi milik
-- poem-edit-service (revision_db).
CREATE TABLE IF NOT EXISTS submission (
  poem_id         UUID         PRIMARY KEY,
  author_id       VARCHAR(64)  NOT NULL,          -- dari header X-User-Id, bukan dari body
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
  UNIQUE (author_id, idempotency_key)               -- kirim ulang tidak menggandakan puisi
);

CREATE INDEX IF NOT EXISTS submission_author_idx ON submission (author_id, created_at DESC);
