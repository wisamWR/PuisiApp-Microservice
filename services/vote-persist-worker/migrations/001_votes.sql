-- Suara permanen (write-behind dari Redis lewat vote.cast). Satu baris per
-- pasangan (puisi, pengguna). Suara yang ditarik disimpan sebagai value = 0
-- (tombstone) supaya sequence tetap tercatat dan suara lama yang tiba
-- terlambat tidak menghidupkannya kembali.
CREATE TABLE IF NOT EXISTS votes (
  poem_id      UUID         NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  value        SMALLINT     NOT NULL CHECK (value IN (-1, 0, 1)),
  weight       REAL         NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 1),
  sequence     BIGINT       NOT NULL CHECK (sequence >= 1),  -- urutan suara per puisi dari vote-service
  updated_at   TIMESTAMPTZ  NOT NULL,                        -- cast_at
  persisted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (poem_id, user_id)
);

-- Hitungan per puisi dan rekonsiliasi hanya membaca suara aktif.
CREATE INDEX IF NOT EXISTS votes_poem_aktif_idx ON votes (poem_id) WHERE value <> 0;
