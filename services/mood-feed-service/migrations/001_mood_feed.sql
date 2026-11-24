CREATE TABLE IF NOT EXISTS mood_poems (
    poem_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT 'Tanpa Judul',
    author_id TEXT,
    author_name TEXT NOT NULL DEFAULT 'Penyair PuisiApp',
    excerpt TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    dominant TEXT,
    model TEXT,
    poem_scores JSONB NOT NULL DEFAULT '{"senang":0.2,"sedih":0.2,"cinta":0.2,"marah":0.2,"takut":0.2}'::jsonb,
    lines JSONB NOT NULL DEFAULT '[]'::jsonb,
    wilson_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    published_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mood_poems_status_pub
    ON mood_poems (status, published_at DESC);
