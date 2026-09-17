-- Additive security metadata; retain business records and existing inventory.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_reserved_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_reservation_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_released_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_hold_reason VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);
CREATE INDEX IF NOT EXISTS idx_orders_inventory_expiry ON orders(inventory_reservation_expires_at)
  WHERE inventory_reserved_at IS NOT NULL AND inventory_released_at IS NULL AND inventory_deducted_at IS NULL;

CREATE TABLE IF NOT EXISTS payment_refunds (
  refund_id VARCHAR(255) PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id VARCHAR(255) NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_order ON payment_refunds(order_id);

CREATE TABLE IF NOT EXISTS security_rate_limits (
  key_hash VARCHAR(64) PRIMARY KEY,
  hits BIGINT NOT NULL CHECK (hits >= 0),
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_rate_limits_expiry ON security_rate_limits(reset_at);

-- Row-based leases survive transaction-pool connection changes. Tokens fence
-- stale owners; durable shipment pending_operation still guards remote retries.
CREATE TABLE IF NOT EXISTS operation_leases (
  lock_key VARCHAR(255) PRIMARY KEY,
  owner_token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operation_leases_expiry ON operation_leases(expires_at);

-- Old COD orders were not allocated inventory. Do not guess stock deductions
-- or dispatch these until their saved stock/order history is reconciled.
UPDATE orders SET fulfillment_hold_reason = 'legacy_cod_inventory_review', updated_at = NOW()
WHERE payment_method = 'cod' AND inventory_deducted_at IS NULL
  AND fulfillment_hold_reason IS NULL AND order_status IN ('placed','confirmed','processing');
