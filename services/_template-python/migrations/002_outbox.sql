CREATE TABLE IF NOT EXISTS outbox (
    event_id UUID PRIMARY KEY,
    aggregate_type VARCHAR(40) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_created_at_idx
    ON outbox (created_at);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'debezium'
    ) THEN
        GRANT SELECT ON outbox TO debezium;
    END IF;
END
$$;
