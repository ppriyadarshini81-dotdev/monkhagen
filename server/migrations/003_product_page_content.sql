CREATE TABLE IF NOT EXISTS product_page_content (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  size_chart_image_url TEXT NOT NULL DEFAULT '',
  care_instructions TEXT NOT NULL DEFAULT '',
  delivery_estimate VARCHAR(200) NOT NULL,
  delivery_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initial editable business content. Never overwrite saved administrator edits.
INSERT INTO product_page_content (id, delivery_estimate, delivery_note)
VALUES (
  TRUE,
  '2–4 days',
  'Some locations where express shipping is not available may take up to 7 days.'
)
ON CONFLICT (id) DO NOTHING;
