CREATE TABLE IF NOT EXISTS poem_signatures (
    id BIGSERIAL PRIMARY KEY,
    poem_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    shingle_count INTEGER NOT NULL CHECK (shingle_count >= 0),
    signature JSONB NOT NULL,
    stanza_signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (poem_id, version)
);

CREATE TABLE IF NOT EXISTS lsh_buckets (
    id BIGSERIAL PRIMARY KEY,
    poem_id UUID NOT NULL,
    version INTEGER NOT NULL,
    stanza INTEGER,
    band INTEGER NOT NULL CHECK (band >= 0 AND band < 32),
    bucket_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (stanza IS NULL OR stanza >= 1),
    FOREIGN KEY (poem_id, version)
        REFERENCES poem_signatures (poem_id, version)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lsh_buckets_lookup_idx
    ON lsh_buckets (band, bucket_hash);

CREATE UNIQUE INDEX IF NOT EXISTS lsh_buckets_unique_idx
    ON lsh_buckets (poem_id, version, COALESCE(stanza, 0), band);

CREATE INDEX IF NOT EXISTS poem_signatures_poem_idx
    ON poem_signatures (poem_id, version);
