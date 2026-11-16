-- Tabel outbox standar (Listing A.3 laporan). Ditulis dalam transaksi yang
-- sama dengan data bisnis, lalu dibaca outbox-relay dari WAL (Debezium) atau
-- secara polling (cadangan). Format tabel sama untuk kedua relay.
CREATE TABLE IF NOT EXISTS outbox (
  event_id       UUID         PRIMARY KEY,
  aggregate_type VARCHAR(40)  NOT NULL,          -- mis. 'poem'
  aggregate_id   VARCHAR(64)  NOT NULL,
  event_type     VARCHAR(80)  NOT NULL,          -- routing key, mis. 'poem.submitted'
  payload        JSONB        NOT NULL,          -- amplop event lengkap
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON outbox (created_at);

-- Publication untuk Debezium (pgoutput) hanya mencakup tabel outbox, dan
-- hanya INSERT: DELETE saat pembersihan atau relay polling tidak diterbitkan.
-- Dibuat di sini oleh pemilik tabel, sehingga user relay tidak perlu hak
-- membuat publication. Hak SELECT untuk user relay diberikan bila role-nya ada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'outbox_pub') THEN
    CREATE PUBLICATION outbox_pub FOR TABLE outbox WITH (publish = 'insert');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'debezium') THEN
    GRANT SELECT ON outbox TO debezium;
  END IF;
END
$$;
