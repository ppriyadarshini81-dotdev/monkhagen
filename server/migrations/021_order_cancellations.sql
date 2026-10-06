-- One durable cancellation record per order.  It is deliberately separate from
-- returns: these orders have not reached the customer.
CREATE TABLE IF NOT EXISTS order_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  cancelled_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason VARCHAR(500),
  status VARCHAR(40) NOT NULL CHECK (status IN ('cancelling','cancelled','reconciliation_required')),
  shiprocket_status VARCHAR(40) NOT NULL DEFAULT 'not_required' CHECK (shiprocket_status IN ('not_required','pending','cancelled','reconciliation_required','failed')),
  shiprocket_order_id BIGINT,
  shiprocket_cancelled_at TIMESTAMPTZ,
  refund_status VARCHAR(40) NOT NULL DEFAULT 'not_applicable' CHECK (refund_status IN ('not_applicable','pending','processing','refunded','reconciliation_required','failed')),
  razorpay_refund_id VARCHAR(255) UNIQUE,
  refund_initiated_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_cancellations_status ON order_cancellations(status, updated_at);
