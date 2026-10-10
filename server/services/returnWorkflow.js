function outboundStage(order = {}) {
  const labels = [order.trackingStatus, order.shippingStatus].map(value => String(value || '').toLowerCase().replace(/[_-]+/g, ' '));
  const label = labels.join(' ');
  if (order.status === 'delivered' || labels.some(value => /^(shipment )?delivered$/.test(value))) return 5;
  if (/out for delivery/.test(label)) return 4;
  if (order.status === 'shipped' || /shipped|picked up|in transit/.test(label)) return 3;
  if (order.pickupStatus === 'scheduled' || /pickup scheduled|out for pickup/.test(label)) return 2;
  if (order.awb) return 1;
  return 0;
}

// The return task can be closed while its outbound order continues through the
// dedicated fulfillment tab. Failed/pending provider operations remain visible.
function adminCategory(row) {
  if (['cancelled', 'rejected', 'refunded'].includes(row.status)) return 'completed';
  if (['requested', 'return_created', 'shiprocket_failed', 'pickup_scheduled', 'picked_up', 'in_transit', 'pickup_failed'].includes(row.status)) return 'requested';
  if (row.status === 'received' || row.pending_operation ||
      (row.payment_method === 'cod' && ['PROVIDED', 'PROCESSING', 'FAILED'].includes(row.refund_destination_status))) return 'inspection_required';
  if (row.outbound_order) {
    if (row.outbound_order.holdReason || row.outbound_order.pendingOperation || row.outbound_order.lastErrorCode ||
        ['failed', 'cancelled', 'needs_review'].includes(row.outbound_order.shippingStatus) ||
        (outboundStage(row.outbound_order) < 2)) return 'outbound';
    return 'completed';
  }
  return row.status === 'approved' || row.status === 'manual_required' ? 'inspection_required' : 'completed';
}

const ADMIN_CATEGORY_SQL = `CASE
  WHEN rr.status IN ('cancelled','rejected','refunded') THEN 'completed'
  WHEN rr.status IN ('requested','return_created','shiprocket_failed','pickup_scheduled','picked_up','in_transit','pickup_failed') THEN 'requested'
  WHEN rr.status = 'received' OR rr.pending_operation IS NOT NULL
    OR (original.payment_method = 'cod' AND d.status IN ('PROVIDED','PROCESSING','FAILED')) THEN 'inspection_required'
  WHEN child.id IS NOT NULL THEN CASE
    WHEN child.fulfillment_hold_reason IS NOT NULL OR s.pending_operation IS NOT NULL OR s.last_error_code IS NOT NULL
      OR s.shipping_status IN ('failed','cancelled','needs_review')
      OR (child.order_status NOT IN ('shipped','delivered') AND s.pickup_status IS DISTINCT FROM 'scheduled'
        AND LOWER(COALESCE(s.shipping_status,'')) NOT IN ('shipped','out_for_delivery','delivered')) THEN 'outbound'
    ELSE 'completed' END
  WHEN rr.status IN ('approved','manual_required') THEN 'inspection_required'
  ELSE 'completed' END`;

module.exports = { outboundStage, adminCategory, ADMIN_CATEGORY_SQL };
