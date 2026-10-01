CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text VARCHAR(2000) NOT NULL DEFAULT '',
  moderation_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('approved', 'hidden')),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id),
  UNIQUE (order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_public
  ON product_reviews(product_id, moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_rating
  ON product_reviews(product_id, moderation_status, rating);

CREATE TABLE IF NOT EXISTS product_review_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  object_key VARCHAR(512) NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  sort_order SMALLINT NOT NULL CHECK (sort_order BETWEEN 0 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (review_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_product_review_images_review
  ON product_review_images(review_id, sort_order);

CREATE TABLE IF NOT EXISTS product_review_helpful (
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_review_helpful_review
  ON product_review_helpful(review_id);
