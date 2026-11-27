
-- Salinan status publikasi puisi
CREATE TABLE IF NOT EXISTS poem_publication_status (
    poem_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (
        status IN ('PUBLISHED', 'HIDDEN', 'DELETED')
    ),
    aggregate_version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Data komentar
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY,
    poem_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (
        char_length(content) BETWEEN 1 AND 1000
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_poem_created
ON comments (poem_id, created_at DESC);

-- Proyeksi nama pengguna dari event user.registered / user.profile.updated
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    display_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
