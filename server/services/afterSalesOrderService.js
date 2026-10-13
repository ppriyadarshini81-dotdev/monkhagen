async function ensureOrder(client, returnId, actorUserId) {
  const result = await client.query(`INSERT INTO orders (user_id, order_number, subtotal, discount_amount, shipping_amount, total_amount,
    payment_method, payment_status, order_status, order_type, source_order_id, return_request_id, created_by, fulfillment_hold_reason)
    SELECT rr.user_id, 'AS-' || REPLACE(rr.id::text, '-', ''), 0, 0, 0, 0, 'razorpay', 'paid', 'confirmed',
      CASE WHEN rr.request_type='replacement' AND EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_request_id = rr.id AND ri.inspection_status = 'approved')
        THEN 'replacement' ELSE 'rejected_return' END, rr.order_id, rr.id, $2, 'AFTER_SALES_PROVIDER_PENDING'
    FROM return_requests rr WHERE rr.id = $1
    ON CONFLICT (return_request_id) WHERE return_request_id IS NOT NULL DO UPDATE SET updated_at = orders.updated_at
    RETURNING id, order_number, order_type`, [returnId, actorUserId || null]);
  const order = result.rows[0];
  if (!order) throw Object.assign(new Error('Return request not found.'), { status: 404, code: 'RETURN_NOT_FOUND' });
  await client.query(`INSERT INTO order_addresses (order_id, full_name, phone, email, address_line1, address_line2, landmark, city, state, postal_code, country)
    SELECT $1, a.full_name, a.phone, a.email, a.address_line1, a.address_line2, a.landmark, a.city, a.state, a.postal_code, a.country
    FROM order_addresses a JOIN return_requests rr ON rr.order_id = a.order_id WHERE rr.id = $2
    ON CONFLICT (order_id) DO NOTHING`, [order.id, returnId]);
  await client.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, quantity,
    unit_price, total_price, fulfillment_type, return_item_id, inspection_reason, declared_unit_price)
    SELECT $1, oi.product_id, CASE WHEN ri.inspection_status = 'approved' THEN replacement.id ELSE oi.variant_id END,
      oi.product_name, CASE WHEN ri.inspection_status = 'approved' THEN COALESCE(replacement.sku, oi.product_id::text || '-' || ri.replacement_size) ELSE oi.sku END,
      CASE WHEN ri.inspection_status = 'approved' THEN ri.replacement_size ELSE oi.size END,
      oi.color, ri.quantity, 0, 0, CASE WHEN ri.inspection_status = 'approved' THEN 'replacement' ELSE 'rejected_return' END,
      ri.id, ri.inspection_reason, oi.unit_price
    FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
    LEFT JOIN LATERAL (SELECT pv.id, pv.sku FROM product_variants pv JOIN sizes s ON s.id = pv.size_id
      WHERE pv.product_id = oi.product_id AND LOWER(s.name) = LOWER(ri.replacement_size)
        AND pv.color_id IS NOT DISTINCT FROM (SELECT color_id FROM product_variants WHERE id = oi.variant_id)
      ORDER BY pv.id LIMIT 1) replacement ON TRUE
    WHERE ri.return_request_id = $2 AND (ri.inspection_status='rejected' OR
      (ri.inspection_status='approved' AND EXISTS (SELECT 1 FROM return_requests rr WHERE rr.id=$2 AND rr.request_type='replacement')))
    ON CONFLICT (return_item_id) WHERE return_item_id IS NOT NULL DO NOTHING`, [order.id, returnId]);
  return order;
}

async function saveShipment(client, returnId, remote, payload) {
  const result = await client.query(`UPDATE orders SET fulfillment_hold_reason = NULL, updated_at = NOW()
    WHERE return_request_id = $1 AND order_type <> 'normal' RETURNING id`, [returnId]);
  if (!result.rows[0]) throw Object.assign(new Error('The linked outbound order needs review.'), { status: 409, code: 'REPLACEMENT_ORDER_MISSING' });
  await client.query(`INSERT INTO shipments (order_id, shiprocket_order_id, shiprocket_shipment_id, awb_code, shipping_status,
    pickup_location, package_weight, package_length, package_breadth, package_height)
    VALUES ($1,$2,$3,$4,'created',$5,$6,$7,$8,$9)
    ON CONFLICT (order_id) DO UPDATE SET shiprocket_order_id = EXCLUDED.shiprocket_order_id,
      shiprocket_shipment_id = EXCLUDED.shiprocket_shipment_id, awb_code = EXCLUDED.awb_code,
      shipping_status = 'created', pending_operation = NULL, last_error_code = NULL, updated_at = NOW()`,
  [result.rows[0].id, remote.orderId, remote.shipmentId, remote.awb || null, payload.pickup_location,
    payload.weight, payload.length, payload.breadth, payload.height]);
}

module.exports = { ensureOrder, saveShipment };
