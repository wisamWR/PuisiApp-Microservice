-- Proyeksi contoh: versi terakhir setiap puisi yang diterima konsumen.
-- jumlah_diproses membantu membuktikan event duplikat tidak diproses dua kali.
CREATE TABLE IF NOT EXISTS contoh_puisi (
  poem_id         TEXT PRIMARY KEY,
  versi           INT  NOT NULL,
  judul           TEXT,
  jumlah_diproses INT  NOT NULL DEFAULT 1,
  diperbarui_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
