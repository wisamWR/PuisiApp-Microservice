-- notif_db (notification-service, T2.8). processed_event dari migrasi standar.

-- Salinan puisi dari poem.submitted / revised dan status dari publication-service:
-- untuk mengetahui penerima (author_id) dan judul, karena event status tidak membawanya.
CREATE TABLE IF NOT EXISTS puisi (
  poem_id    VARCHAR(64)  PRIMARY KEY,
  author_id  VARCHAR(64),
  judul      VARCHAR(150),
  versi      INT          NOT NULL DEFAULT 1,
  status     VARCHAR(16),
  status_at  TIMESTAMPTZ
);

-- Salinan laporan (report.created) dan kasus (case.opened / case.decided) untuk
-- menemukan pelapor saat keputusan keluar.
CREATE TABLE IF NOT EXISTS laporan (
  report_id    VARCHAR(64)  PRIMARY KEY,
  poem_id      VARCHAR(64)  NOT NULL,
  reporter_id  VARCHAR(64)  NOT NULL
);
CREATE TABLE IF NOT EXISTS kasus (
  case_id    VARCHAR(64)  PRIMARY KEY,
  report_id  VARCHAR(64),
  poem_id    VARCHAR(64)  NOT NULL
);

CREATE TABLE IF NOT EXISTS notifikasi (
  id           UUID          PRIMARY KEY,   -- UUIDv5(event_id + penerima): event ganda -> id sama
  event_id     UUID          NOT NULL,
  penerima_id  VARCHAR(64)   NOT NULL,
  jenis        VARCHAR(40)   NOT NULL,
  judul        VARCHAR(200)  NOT NULL,
  pesan        TEXT          NOT NULL,
  poem_id      VARCHAR(64),
  tautan       TEXT,
  dibaca_at    TIMESTAMPTZ,
  dibuat_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (event_id, penerima_id)
);
CREATE INDEX IF NOT EXISTS notifikasi_penerima_idx ON notifikasi (penerima_id, dibuat_at DESC);
CREATE INDEX IF NOT EXISTS notifikasi_belum_dibaca_idx ON notifikasi (penerima_id) WHERE dibaca_at IS NULL;
