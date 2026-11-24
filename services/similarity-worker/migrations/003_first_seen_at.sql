
-- Menyimpan waktu pertama kali sebuah puisi tercatat.
CREATE TABLE IF NOT EXISTS poem_first_seen (
    poem_id UUID PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mengisi data puisi yang sudah tersimpan sebelum migrasi ini.
-- Untuk setiap puisi, gunakan waktu versi paling awal.
INSERT INTO poem_first_seen (poem_id, first_seen_at)
SELECT
    poem_id,
    MIN(created_at)
FROM poem_signatures
GROUP BY poem_id
ON CONFLICT (poem_id) DO NOTHING;
