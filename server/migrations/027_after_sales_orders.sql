-- One consolidated outbound order per inspected return. Mixed parcels classify
-- their individual lines so replacements and rejected originals stay distinct.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS return_request_id UUID REFERENCES return_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE orders ADD CONSTRAINT orders_type_check
  CHECK (order_type IN ('normal', 'replacement', 'rejected_return'));
ALTER TABLE orders ADD CONSTRAINT orders_after_sales_source_check
  CHECK ((order_type = 'normal' AND source_order_id IS NULL AND return_request_id IS NULL)
    OR (order_type <> 'normal' AND source_order_id IS NOT NULL AND return_request_id IS NOT NULL
      AND source_order_id <> id AND total_amount = 0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_return_request ON orders(return_request_id)
  WHERE return_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_type_created ON orders(order_type, created_at DESC);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(30) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS return_item_id UUID REFERENCES return_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inspection_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS declared_unit_price NUMERIC(10,2);
ALTER TABLE order_items ADD CONSTRAINT order_items_fulfillment_type_check
  CHECK (fulfillment_type IN ('normal', 'replacement', 'rejected_return'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_return_item ON order_items(return_item_id)
  WHERE return_item_id IS NOT NULL;

-- Preserve outbound provider orders created before this migration; do not book
-- or enqueue any remote shipment during a database upgrade.
INSERT INTO orders (user_id, order_number, subtotal, discount_amount, shipping_amount, total_amount,
  payment_method, payment_status, order_status, order_type, source_order_id, return_request_id,
  fulfillment_hold_reason, created_at)
SELECT rr.user_id, 'AS-' || REPLACE(rr.id::text, '-', ''), 0, 0, 0, 0, 'razorpay', 'paid',
  CASE WHEN LOWER(COALESCE(rr.outbound_status, '')) = 'delivered' THEN 'delivered' ELSE 'confirmed' END,
  CASE WHEN EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_request_id = rr.id AND ri.inspection_status = 'approved')
    THEN 'replacement' ELSE 'rejected_return' END,
  rr.order_id, rr.id, CASE WHEN rr.pending_operation IS NOT NULL THEN 'AFTER_SALES_RECONCILIATION_REQUIRED' ELSE NULL END,
  COALESCE(rr.outbound_created_at, rr.updated_at)
FROM return_requests rr WHERE rr.shiprocket_outbound_shipment_id IS NOT NULL
ON CONFLICT (return_request_id) WHERE return_request_id IS NOT NULL DO NOTHING;

INSERT INTO order_addresses (order_id, full_name, phone, email, address_line1, address_line2, landmark, city, state, postal_code, country)
SELECT child.id, a.full_name, a.phone, a.email, a.address_line1, a.address_line2, a.landmark, a.city, a.state, a.postal_code, a.country
FROM orders child JOIN order_addresses a ON a.order_id = child.source_order_id WHERE child.order_type <> 'normal'
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, quantity, unit_price, total_price,
  fulfillment_type, return_item_id, inspection_reason, declared_unit_price)
SELECT child.id, oi.product_id, CASE WHEN ri.inspection_status = 'rejected' THEN oi.variant_id ELSE NULL END,
  oi.product_name, CASE WHEN ri.inspection_status = 'approved' THEN oi.product_id::text || '-' || ri.replacement_size ELSE oi.sku END,
  CASE WHEN ri.inspection_status = 'approved' THEN ri.replacement_size ELSE oi.size END,
  oi.color, ri.quantity, 0, 0, CASE WHEN ri.inspection_status = 'approved' THEN 'replacement' ELSE 'rejected_return' END,
  ri.id, ri.inspection_reason, oi.unit_price
FROM orders child JOIN return_items ri ON ri.return_request_id = child.return_request_id
JOIN order_items oi ON oi.id = ri.order_item_id WHERE child.order_type <> 'normal'
ON CONFLICT (return_item_id) WHERE return_item_id IS NOT NULL DO NOTHING;

INSERT INTO shipments (order_id, shiprocket_order_id, shiprocket_shipment_id, awb_code, shipping_status, tracking_status,
  tracking_url, pickup_location, pending_operation, last_error_code)
SELECT child.id, rr.shiprocket_outbound_order_id, rr.shiprocket_outbound_shipment_id, rr.outbound_awb,
  CASE WHEN rr.pending_operation IS NOT NULL THEN 'needs_review' ELSE COALESCE(rr.outbound_status, 'created') END,
  rr.outbound_status, rr.outbound_tracking_url, NULL,
  CASE WHEN rr.pending_operation IS NOT NULL THEN 'create' ELSE NULL END,
  CASE WHEN rr.pending_operation IS NOT NULL THEN 'SHIPPING_RECONCILIATION_REQUIRED' ELSE NULL END
FROM orders child JOIN return_requests rr ON rr.id = child.return_request_id
WHERE child.order_type <> 'normal' AND rr.shiprocket_outbound_shipment_id IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;
