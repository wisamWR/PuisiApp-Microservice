CREATE TABLE IF NOT EXISTS authorship_records (
    id BIGSERIAL PRIMARY KEY,
    poem_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    content_hash VARCHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    previous_hash VARCHAR(64) NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
    chain_hash VARCHAR(64) NOT NULL CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_event_id UUID NOT NULL UNIQUE,
    UNIQUE (poem_id, version)
);

CREATE INDEX IF NOT EXISTS authorship_records_poem_idx
    ON authorship_records (poem_id, version);

CREATE TABLE IF NOT EXISTS processed_event (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_authorship_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'authorship_records bersifat append-only: UPDATE dan DELETE ditolak';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS authorship_records_immutable
    ON authorship_records;

CREATE TRIGGER authorship_records_immutable
BEFORE UPDATE OR DELETE ON authorship_records
FOR EACH ROW EXECUTE FUNCTION reject_authorship_mutation();
