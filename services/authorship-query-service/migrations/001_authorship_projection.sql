CREATE TABLE IF NOT EXISTS authorship_projection (
    poem_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    content_hash VARCHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    previous_hash VARCHAR(64) NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
    chain_hash VARCHAR(64) NOT NULL CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
    recorded_at TIMESTAMPTZ NOT NULL,
    algorithm VARCHAR(16) NOT NULL CHECK (algorithm = 'SHA-256'),
    source_event_id UUID NOT NULL UNIQUE,
    PRIMARY KEY (poem_id, version)
);

CREATE INDEX IF NOT EXISTS authorship_projection_poem_idx
    ON authorship_projection (poem_id, version);
