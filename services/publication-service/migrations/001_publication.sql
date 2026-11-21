-- publication_db (publication-service, T2.2). Status publikasi satu baris per puisi.
-- Tabel processed_event dan outbox dibuat migrasi standar libs/node.

CREATE TABLE IF NOT EXISTS publication (
  poem_id         UUID         PRIMARY KEY,
  -- NULL hanya untuk tombstone dari poem.deleted yang tiba sebelum poem.submitted.
  author_id       VARCHAR(64),
  status          VARCHAR(16)  NOT NULL
                  CHECK (status IN ('PROCESSING', 'REPROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN', 'DELETED')),
  -- Versi terbaru yang diterima (sedang atau sudah dinilai).
  versi           INT          NOT NULL CHECK (versi >= 1),
  -- Versi yang tampil publik; tetap versi lama selama REPROCESSING. NULL = belum pernah terbit.
  versi_tampil    INT          CHECK (versi_tampil >= 1),
  level_kemiripan VARCHAR(32),
  skor_kemiripan  NUMERIC(5, 4),
  case_id         VARCHAR(64),
  -- decided_at case.decided terakhir; keputusan yang lebih lama diabaikan (event basi).
  keputusan_at    TIMESTAMPTZ,
  -- Optimistic locking: naik 1 setiap UPDATE.
  row_version     INT          NOT NULL DEFAULT 1,
  dibuat_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  diubah_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publication_status_idx ON publication (status);
