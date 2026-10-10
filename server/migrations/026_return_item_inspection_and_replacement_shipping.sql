-- Inspection is decided per returned product. A request can still share one
-- reverse pickup and one outbound Shiprocket shipment.
ALTER TABLE return_items
  ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inspection_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspected_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE return_items DROP CONSTRAINT IF EXISTS return_items_inspection_status_check;
ALTER TABLE return_items ADD CONSTRAINT return_items_inspection_status_check
  CHECK (inspection_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS shiprocket_outbound_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS shiprocket_outbound_shipment_id BIGINT,
  ADD COLUMN IF NOT EXISTS outbound_awb VARCHAR(100),
  ADD COLUMN IF NOT EXISTS outbound_status VARCHAR(80),
  ADD COLUMN IF NOT EXISTS outbound_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS outbound_created_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_outbound_order
  ON return_requests(shiprocket_outbound_order_id) WHERE shiprocket_outbound_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_requests_outbound_shipment
  ON return_requests(shiprocket_outbound_shipment_id) WHERE shiprocket_outbound_shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_return_items_inspection
  ON return_items(return_request_id, inspection_status);
