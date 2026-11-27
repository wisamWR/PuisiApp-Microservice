CREATE TABLE IF NOT EXISTS recovery_accounts (
  user_id        UUID PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  username       TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_tokens (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL,
  jenis       TEXT NOT NULL CHECK (jenis IN ('verify_email', 'reset_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_user_jenis
  ON recovery_tokens (user_id, jenis);
