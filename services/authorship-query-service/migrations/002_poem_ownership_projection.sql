CREATE TABLE IF NOT EXISTS poem_ownership_projection (
    poem_id UUID PRIMARY KEY,
    author_id VARCHAR(64) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poem_ownership_projection_author_idx
    ON poem_ownership_projection (author_id);
