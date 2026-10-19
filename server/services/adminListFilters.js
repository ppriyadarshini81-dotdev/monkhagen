function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

// Only fixed SQL expressions enter the query; all administrator input is bound.
function adminListFilters(query = {}, { returns = false, afterSales = false, values = [] } = {}) {
  const clauses = [];
  const add = value => { values.push(value); return `$${values.length}`; };
  const choice = (key, allowed, column) => {
    if (!query[key]) return;
    if (!allowed.includes(query[key])) invalid(`Invalid ${key} filter.`);
    clauses.push(`${column} = ${add(query[key])}`);
  };
  const alias = returns ? 'rr' : 'o';
  const orderId = returns ? 'rr.order_id' : 'o.id';
  if (query.search) {
    if (typeof query.search !== 'string' || query.search.length > 200) invalid('Search must be at most 200 characters.');
    const ref = add(`%${query.search.trim()}%`);
    clauses.push(`(${alias}.id::text ILIKE ${ref} OR ${returns ? 'rr.return_number' : 'o.order_number'} ILIKE ${ref}
      ${returns ? `OR original.order_number ILIKE ${ref}` : ''}
      ${afterSales ? `OR original.order_number ILIKE ${ref} OR rr.return_number ILIKE ${ref}` : ''}
      OR EXISTS (SELECT 1 FROM users filter_user WHERE filter_user.id = ${returns ? 'rr.user_id' : 'o.user_id'}
        AND (filter_user.name ILIKE ${ref} OR filter_user.email ILIKE ${ref} OR filter_user.phone ILIKE ${ref}))
      OR EXISTS (SELECT 1 FROM order_addresses filter_address WHERE filter_address.order_id = ${orderId}
        AND (filter_address.full_name ILIKE ${ref} OR filter_address.phone ILIKE ${ref} OR filter_address.email ILIKE ${ref}))
      OR EXISTS (SELECT 1 FROM order_items filter_item ${returns ? 'JOIN return_items filter_return_item ON filter_return_item.order_item_id = filter_item.id' : ''}
        WHERE ${returns ? 'filter_return_item.return_request_id = rr.id' : `filter_item.order_id = ${orderId}`} AND filter_item.product_name ILIKE ${ref}))`);
  }
  choice('status', returns
    ? ['requested','return_created','shiprocket_failed','pickup_scheduled','picked_up','in_transit','received','approved','refund_initiated','refunded','rejected','cancelled','pickup_failed']
    : ['placed','confirmed','processing','shipped','delivered','cancelled','return_requested','returned'], returns ? 'rr.status' : 'o.order_status');
  choice('paymentMethod', ['cod','razorpay'], returns || afterSales ? 'original.payment_method' : 'o.payment_method');
  if (returns) {
    choice('requestType', ['return','replacement','defect'], 'rr.request_type');
    choice('refundStatus', ['pending','initiated','processing','refunded','completed','failed','not_applicable','manual_required'], 'rr.refund_status');
  } else {
    choice('paymentStatus', ['pending','paid','failed','refunded','partially_refunded'], 'o.payment_status');
    if (afterSales) choice('requestType', ['replacement','rejected_return'], 'o.order_type');
    if (query.fulfillment && query.fulfillment !== 'all') {
      const delivered = `(o.order_status = 'delivered' OR LOWER(COALESCE(s.tracking_status,'')) = 'delivered' OR LOWER(COALESCE(s.shipping_status,'')) = 'delivered')`;
      const filters = {
        attention: "COALESCE(s.last_error_code,o.fulfillment_hold_reason) IS NOT NULL",
        unfulfilled: "o.payment_status = 'paid' AND COALESCE(s.awb_code,o.awb_number) IS NULL AND o.order_status <> 'cancelled'",
        shipped: `COALESCE(s.awb_code,o.awb_number) IS NOT NULL AND NOT ${delivered} AND o.order_status <> 'cancelled'`,
        delivered
      };
      if (!Object.hasOwn(filters, query.fulfillment)) invalid('Invalid fulfillment filter.');
      clauses.push(`(${filters[query.fulfillment]})`);
    }
  }
  for (const key of ['from','to']) {
    if (!query[key]) continue;
    const value = query[key];
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) invalid('Invalid date filter.');
    const ref = add(value);
    const midnight = key === 'to' ? `(${ref}::date + INTERVAL '1 day')` : `${ref}::date::timestamp`;
    clauses.push(`${alias}.created_at ${key === 'from' ? '>=' : '<'} (${midnight} AT TIME ZONE 'Asia/Kolkata')`);
  }
  if (query.from && query.to && query.from > query.to) invalid('From date must be before the end date.');
  if (query.sort && !['newest','oldest'].includes(query.sort)) invalid('Invalid sort filter.');
  const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';
  return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', order: `${alias}.created_at ${direction}, ${alias}.id ${direction}`, values };
}
module.exports = adminListFilters;
