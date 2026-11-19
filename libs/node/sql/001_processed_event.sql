-- Tabel standar idempotensi konsumen (Listing A.3 laporan).
-- Ada di setiap database layanan yang mengonsumsi event.
CREATE TABLE IF NOT EXISTS processed_event (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
