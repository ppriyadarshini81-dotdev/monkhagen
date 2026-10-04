-- Size-level inventory is an extension of the existing product/size mapping.
-- Existing variant quantities are deliberately not copied: their distribution
-- was historically calculated from a product total and cannot be trusted as a
-- real size allocation. Existing products therefore require explicit setup.

ALTER TABLE product_size_details
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_configured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE product_size_details ADD CONSTRAINT product_size_stock_nonnegative CHECK (stock_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE product_size_details ADD CONSTRAINT product_size_initial_stock_nonnegative CHECK (initial_stock_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE product_size_details ADD CONSTRAINT product_size_threshold_nonnegative CHECK (low_stock_threshold_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_product_size_inventory_status
  ON product_size_details (is_active, inventory_configured, stock_quantity, low_stock_threshold_quantity);
CREATE INDEX IF NOT EXISTS idx_product_size_inventory_updated
  ON product_size_details (updated_at DESC);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_size_detail_id UUID NOT NULL REFERENCES product_size_details(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  size_id UUID NOT NULL REFERENCES sizes(id) ON DELETE RESTRICT,
  movement_type VARCHAR(40) NOT NULL CHECK (movement_type IN (
    'OPENING_STOCK', 'ADMIN_ADJUSTMENT', 'ORDER_RESERVED', 'ORDER_SOLD',
    'PAYMENT_RESERVATION_RELEASED', 'ORDER_CANCELLED', 'RETURN_RESTOCKED'
  )),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  return_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  reason VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_after = quantity_before + quantity_change)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_created
  ON inventory_movements (product_size_detail_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
  ON inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
  ON inventory_movements (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_return
  ON inventory_movements (return_id) WHERE return_id IS NOT NULL;
