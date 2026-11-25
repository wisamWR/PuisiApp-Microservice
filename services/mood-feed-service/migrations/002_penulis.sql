-- Nama penulis untuk kartu feed. Event poem.* hanya membawa author_id, jadi nama
-- diambil dari user.registered (username) dan user.profile.updated (display_name).
CREATE TABLE IF NOT EXISTS mood_penulis (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    display_name TEXT,
    profil_at TIMESTAMPTZ,
    diubah_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mood_poems_author ON mood_poems (author_id);
