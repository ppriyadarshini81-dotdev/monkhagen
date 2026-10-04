-- Durable, item-level customer returns. This migration is additive except for
-- widening the two existing check constraints to the controlled lifecycle.
ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_status_check;
ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_refund_status_check;

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS shiprocket_return_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS shiprocket_return_shipment_id BIGINT,
  ADD COLUMN IF NOT EXISTS return_awb VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pickup_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pending_operation VARCHAR(50),
  ADD COLUMN IF NOT EXISTS operation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS razorpay_refund_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS inventory_restored_at TIMESTAMPTZ;

ALTER TABLE return_items ADD COLUMN IF NOT EXISTS comments TEXT;

-- Preserve legacy completed rows while moving them into the explicit refund
-- lifecycle before the stricter constraint is installed.
UPDATE return_requests
SET status = CASE WHEN refund_status = 'refunded' THEN 'refunded' ELSE 'approved' END,
    approved_at = COALESCE(approved_at, completed_at),
    refunded_at = CASE WHEN refund_status = 'refunded' THEN COALESCE(completed_at, updated_at) ELSE refunded_at END
WHERE status = 'completed';

ALTER TABLE return_requests ADD CONSTRAINT return_requests_status_check CHECK (status IN (
  'requested', 'return_created', 'pickup_scheduled', 'picked_up', 'in_transit',
  'received', 'approved', 'refund_initiated', 'refunded', 'shiprocket_failed',
  'pickup_failed', 'cancelled', 'rejected'
));
ALTER TABLE return_requests ADD CONSTRAINT return_requests_refund_status_check CHECK (refund_status IN (
  'pending', 'processing', 'refunded', 'failed', 'manual_required', 'not_applicable'
));

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_idempotency
  ON return_requests(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_shiprocket_order
  ON return_requests(shiprocket_return_order_id) WHERE shiprocket_return_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_shiprocket_shipment
  ON return_requests(shiprocket_return_shipment_id) WHERE shiprocket_return_shipment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_awb
  ON return_requests(return_awb) WHERE return_awb IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_razorpay_refund
  ON return_requests(razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS return_webhook_events (
  event_id VARCHAR(64) PRIMARY KEY,
  return_request_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
