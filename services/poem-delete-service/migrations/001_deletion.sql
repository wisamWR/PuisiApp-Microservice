-- deletion_db (poem-delete-service). Sesuai Listing A.3 laporan.

-- Salinan kepemilikan dari poem.submitted dan versi terakhir dari poem.revised.
CREATE TABLE IF NOT EXISTS poem_ownership (
  poem_id        UUID        PRIMARY KEY,
  author_id      VARCHAR(64) NOT NULL,
  versi_terakhir INT         NOT NULL DEFAULT 1
);

-- Satu baris per puisi yang dihapus (soft delete). Append-only.
CREATE TABLE IF NOT EXISTS deletion (
  poem_id        UUID        PRIMARY KEY,
  author_id      VARCHAR(64) NOT NULL,
  versi_terakhir INT         NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
