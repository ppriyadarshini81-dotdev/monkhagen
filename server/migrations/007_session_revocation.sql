-- Additive session revocation metadata; no passwords or bearer tokens stored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 0 CHECK (session_version >= 0);
