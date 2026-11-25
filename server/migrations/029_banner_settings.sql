CREATE TABLE IF NOT EXISTS banner_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  messages JSONB NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 12),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO banner_settings (id, messages) VALUES (TRUE,
  '["Free shipping across India","COD available","Premium streetwear","Limited drops"]'::jsonb)
ON CONFLICT (id) DO NOTHING;
