-- Generalize existing Google identities for all Firebase authentication providers.
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);

UPDATE users
SET firebase_uid = google_uid
WHERE firebase_uid IS NULL AND google_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_firebase_uid
  ON users(firebase_uid)
  WHERE firebase_uid IS NOT NULL;
