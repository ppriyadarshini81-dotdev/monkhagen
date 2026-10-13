-- Schema-only replacement for the historical 027 backfill.  This migration is
-- deliberately registered under its own schema_migrations name so it never
-- claims that 027_after_sales_orders.sql (the legacy data backfill) ran.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS return_request_id UUID REFERENCES return_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_type_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_type_check
      CHECK (order_type IN ('normal', 'replacement', 'rejected_return'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_after_sales_source_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_after_sales_source_check
      CHECK ((order_type = 'normal' AND source_order_id IS NULL AND return_request_id IS NULL)
        OR (order_type <> 'normal' AND source_order_id IS NOT NULL AND return_request_id IS NOT NULL
          AND source_order_id <> id AND total_amount = 0));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_return_request ON orders(return_request_id)
  WHERE return_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_type_created ON orders(order_type, created_at DESC);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS return_item_id UUID REFERENCES return_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inspection_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS declared_unit_price NUMERIC(10,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_items'::regclass AND conname = 'order_items_fulfillment_type_check') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_fulfillment_type_check
      CHECK (fulfillment_type IN ('normal', 'replacement', 'rejected_return'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_return_item ON order_items(return_item_id)
  WHERE return_item_id IS NOT NULL;
