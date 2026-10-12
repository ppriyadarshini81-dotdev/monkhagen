const { pool } = require('../config/db');
const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const addressValidationError = require('../services/addressValidation');
const { loadIndiaLocations, resolveIndiaLocation } = require('../services/indiaLocations');
const { assertPincodeMatchesLocation, lookupPincode } = require('../services/indiaPincode');
const shipping = require('../services/shippingService');
const returns = require('../services/returnService');
const codRefunds = require('../services/codRefundService');
const cancellations = require('../services/orderCancellationService');

// ── Profile ───────────────────────────────────────────────────────────────────

exports.getProfile = asyncHandler(async (req, res) => {
  res.json(req.user.toJSON());
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, dateOfBirth } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters.' });
  }
  if (phone && !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ message: 'Phone must be a 10-digit number.' });
  }
  const updated = await User.updateProfile(req.user.id, {
    name: name.trim(),
    phone: phone || null,
    dateOfBirth: dateOfBirth || null
  });
  res.json(updated.toJSON());
});

// ── Addresses ─────────────────────────────────────────────────────────────────

function fmtAddr(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 || null,
    landmark: row.landmark || null,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    addressType: row.address_type,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

exports.getAddresses = asyncHandler(async (req, res) => {
  const { limit, offset } = require('../middleware/validation').pagination(req.query);
  const { rows } = await pool.query(
    'SELECT * FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT $2 OFFSET $3',
    [req.user.id, limit, offset]
  );
  res.json(rows.map(fmtAddr));
});

exports.getDefaultAddress = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM customer_addresses WHERE user_id = $1 AND is_default = TRUE LIMIT 1',
    [req.user.id]
  );
  res.json(rows[0] ? fmtAddr(rows[0]) : null);
});

exports.getAddressLocations = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');
  res.json(await loadIndiaLocations());
});

exports.lookupAddressPincode = asyncHandler(async (req, res) => {
  const result = await lookupPincode(req.params.postalCode);
  const location = await resolveIndiaLocation(result.state, result.city);
  if (!location) {
    return res.status(400).json({ message: 'Please enter a valid Indian PIN code.', code: 'PINCODE_LOCATION_UNSUPPORTED' });
  }
  res.set('Cache-Control', 'private, max-age=86400');
  res.json({ postalCode: result.postalCode, ...location });
});

exports.addAddress = asyncHandler(async (req, res) => {
  const validationError = await addressValidationError(req.body, { validateLocation: true });
  if (validationError) return res.status(400).json({ message: validationError });
  const { fullName, phone, email, addressLine1, addressLine2, landmark, city, state, postalCode, country = 'India', addressType = 'Home' } = req.body;
  if (!fullName || !phone || !email || !addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ message: 'fullName, phone, email, addressLine1, city, state and postalCode are required.' });
  }
  const location = await resolveIndiaLocation(state, city);
  await assertPincodeMatchesLocation({ postalCode, city: location.city, state: location.state });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize address creation for this account, including first/default and
    // storage-limit checks, without locking another customer's address book.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows: existing } = await client.query(
      'SELECT COUNT(*)::integer AS count FROM customer_addresses WHERE user_id = $1', [req.user.id]
    );
    if (existing[0].count >= 50) throw Object.assign(new Error('You can save up to 50 addresses. Remove an unused address first.'), { status: 409 });
    const makeDefault = existing[0].count === 0;
    const { rows } = await client.query(
      `INSERT INTO customer_addresses (user_id, full_name, phone, email, address_line1, address_line2, landmark, city, state, postal_code, country, address_type, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user.id, fullName, phone, email.trim().toLowerCase(), addressLine1, addressLine2 || null, landmark || null,
        location.city, location.state, postalCode, 'India', addressType, makeDefault]
    );
    await client.query('COMMIT');
    res.status(201).json(fmtAddr(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: owned } = await pool.query(
    'SELECT id, city, state FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]
  );
  if (!owned[0]) return res.status(404).json({ message: 'Address not found.' });

  const validationError = await addressValidationError(req.body, {
    validateLocation: true,
    legacyLocation: { city: owned[0].city, state: owned[0].state }
  });
  if (validationError) return res.status(400).json({ message: validationError });
  const { fullName, phone, email, addressLine1, addressLine2, landmark, city, state, postalCode, country = 'India', addressType = 'Home' } = req.body;
  const location = await resolveIndiaLocation(state, city);
  await assertPincodeMatchesLocation({ postalCode, city: location?.city || city, state: location?.state || state });
  const { rows } = await pool.query(
    `UPDATE customer_addresses
     SET full_name=$1, phone=$2, email=$3, address_line1=$4, address_line2=$5, landmark=$6,
         city=$7, state=$8, postal_code=$9, country=$10, address_type=$11, updated_at=NOW()
     WHERE id=$12 AND user_id=$13 RETURNING *`,
    [fullName, phone, email.trim().toLowerCase(), addressLine1, addressLine2 || null, landmark || null,
      location?.city || city.trim(), location?.state || state.trim(), postalCode, 'India', addressType, id, req.user.id]
  );
  res.json(fmtAddr(rows[0]));
});

exports.deleteAddress = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Address not found.' });

  // If deleted address was default, promote the oldest remaining address
  if (rows[0].is_default) {
    await pool.query(
      `UPDATE customer_addresses SET is_default = TRUE, updated_at = NOW()
       WHERE id = (SELECT id FROM customer_addresses WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)`,
      [req.user.id]
    );
  }
  res.json({ message: 'Address deleted.' });
});

exports.setDefaultAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: owned } = await pool.query(
    'SELECT id FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]
  );
  if (!owned[0]) return res.status(404).json({ message: 'Address not found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE customer_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );
    const { rows } = await client.query(
      'UPDATE customer_addresses SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    await client.query('COMMIT');
    res.json(fmtAddr(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

function fmtOrderItem(i) {
  return {
    id: i.id,
    productId: i.product_id,
    variantId: i.variant_id,
    productName: i.product_name,
    sku: i.sku || null,
    size: i.size || null,
    color: i.color || null,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    totalPrice: Number(i.total_price),
    imageUrl: i.image_url || null
  };
}

function fmtOrderAddr(a) {
  if (!a) return null;
  return {
    fullName: a.full_name,
    phone: a.phone,
    addressLine1: a.address_line1,
    addressLine2: a.address_line2 || null,
    city: a.city,
    state: a.state,
    postalCode: a.postal_code,
    country: a.country
  };
}

function fmtOrder(o, items, addr) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.order_status,
    paymentStatus: o.payment_status,
    fulfillmentHoldReason: o.fulfillment_hold_reason || null,
    refundedAmount: Number(o.refunded_amount || 0),
    cancellation: o.cancellation_status ? { status: o.cancellation_status, reason: o.cancellation_reason || null,
      cancelledAt: o.cancelled_at || null, refundStatus: o.cancellation_refund_status || 'not_applicable' } : null,
    paymentMethod: o.payment_method,
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discount_amount),
    shippingAmount: Number(o.shipping_amount),
    totalAmount: Number(o.total_amount),
    items: (items || []).map(fmtOrderItem),
    address: fmtOrderAddr(addr),
    awbNumber: o.shipment_awb_code || o.awb_number || null,
    courierName: o.shipment_courier_name || o.courier_name || null,
    trackingUrl: o.shipment_tracking_url || o.tracking_url || null,
    shippingStatus: o.shipment_shipping_status || 'not_created',
    trackingStatus: o.shipment_tracking_status || null,
    pickupStatus: o.shipment_pickup_status || null,
    estimatedDelivery: o.shipment_estimated_delivery || null,
    invoiceAvailable: Boolean(o.invoice_available) && o.order_status !== 'cancelled',
    shippedAt: o.shipped_at || null,
    deliveredAt: o.delivered_at || null,
    createdAt: o.created_at,
    updatedAt: o.updated_at
  };
}

async function enrichOrder(o) {
  const [itemsRes, addrRes] = await Promise.all([
    pool.query(
      `SELECT oi.*,
         (SELECT pi.image_url FROM product_images pi
          WHERE pi.product_id = oi.product_id
          ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
          LIMIT 1) AS image_url
       FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.created_at, oi.id`,
      [o.id]
    ),
    pool.query('SELECT * FROM order_addresses WHERE order_id = $1', [o.id])
  ]);
  return fmtOrder(o, itemsRes.rows, addrRes.rows[0]);
}

function orderDateFilter(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw Object.assign(new Error('Invalid order date filter.'), { status: 400 });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error('Invalid order date filter.'), { status: 400 });
  }
  return value;
}

exports.getOrders = asyncHandler(async (req, res) => {
  const { limit, offset } = require('../middleware/validation').pagination(req.query);
  const requestedStatus = String(req.query.status || '').toLowerCase();
  const statusFilter = { active: ['confirmed', 'processing', 'shipped', 'pickup_scheduled', 'awb_assigned'], cancelled: ['cancelled'], delivered: ['delivered'] }[requestedStatus];
  if (requestedStatus && !statusFilter) return res.status(400).json({ message: 'Invalid order status filter.' });
  const requestedSort = String(req.query.sort || 'newest').toLowerCase();
  if (!['newest', 'oldest'].includes(requestedSort)) return res.status(400).json({ message: 'Invalid order date sort.' });
  const sortDirection = requestedSort === 'oldest' ? 'ASC' : 'DESC';
  const dateFrom = orderDateFilter(req.query.dateFrom);
  const dateTo = orderDateFilter(req.query.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) return res.status(400).json({ message: 'From date must be on or before To date.' });
  const { rows } = await pool.query(
    `SELECT o.*,
       s.awb_code AS shipment_awb_code,
       s.courier_name AS shipment_courier_name,
       s.tracking_url AS shipment_tracking_url,
       s.shipping_status AS shipment_shipping_status,
       s.tracking_status AS shipment_tracking_status,
       s.pickup_status AS shipment_pickup_status,
       s.estimated_delivery AS shipment_estimated_delivery,
       (s.shiprocket_order_id IS NOT NULL) AS invoice_available,
       c.status AS cancellation_status, c.reason AS cancellation_reason, c.cancelled_at, c.refund_status AS cancellation_refund_status
     FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
     LEFT JOIN order_cancellations c ON c.order_id = o.id
     WHERE o.user_id = $1 AND o.order_type = 'normal'
       AND ((o.payment_method = 'razorpay' AND o.razorpay_payment_id IS NOT NULL)
         OR (o.payment_method = 'cod' AND o.payment_status IN ('pending','paid','partially_refunded','refunded')))
       AND ($4::text[] IS NULL OR o.order_status = ANY($4))
       AND ($5::date IS NULL OR o.created_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
       AND ($6::date IS NULL OR o.created_at < (($6::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
     ORDER BY o.created_at ${sortDirection}, o.id ${sortDirection} LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset, statusFilter || null, dateFrom, dateTo]
  );
  const orders = await Promise.all(rows.map(enrichOrder));
  res.json(orders);
});

exports.getOrder = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.*,
       s.awb_code AS shipment_awb_code,
       s.courier_name AS shipment_courier_name,
       s.tracking_url AS shipment_tracking_url,
       s.shipping_status AS shipment_shipping_status,
       s.tracking_status AS shipment_tracking_status,
       s.pickup_status AS shipment_pickup_status,
       s.estimated_delivery AS shipment_estimated_delivery,
       (s.shiprocket_order_id IS NOT NULL) AS invoice_available,
       c.status AS cancellation_status, c.reason AS cancellation_reason, c.cancelled_at, c.refund_status AS cancellation_refund_status
     FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
     LEFT JOIN order_cancellations c ON c.order_id = o.id
     WHERE o.id = $1 AND o.user_id = $2 AND o.order_type = 'normal'
       AND ((o.payment_method = 'razorpay' AND o.razorpay_payment_id IS NOT NULL)
         OR (o.payment_method = 'cod' AND o.payment_status IN ('pending','paid','partially_refunded','refunded')))`,
    [req.params.orderId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Order not found.' });
  res.json(await enrichOrder(rows[0]));
});

exports.getInvoice = asyncHandler(async (req, res) => {
  const invoice = await shipping.invoice(req.params.orderId, req.user);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${invoice.filename}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(invoice.document);
});

exports.getTracking = asyncHandler(async (req, res) => {
  res.json(await shipping.tracking(req.params.orderId, req.user));
});

exports.getCancellationEligibility = asyncHandler(async (req, res) => {
  res.json(await cancellations.getEligibility(req.user.id, req.params.orderId));
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  res.json(await cancellations.cancel(req.user.id, req.params.orderId, req.body?.reason));
});

// ── Returns ───────────────────────────────────────────────────────────────────

exports.getReturns = asyncHandler(async (req, res) => {
  const { limit, offset } = require('../middleware/validation').pagination(req.query);
  const requestedStatus = String(req.query.status || '').toLowerCase();
  const statusFilter = { open: ['requested', 'return_created', 'shiprocket_failed', 'pickup_scheduled', 'picked_up', 'in_transit', 'received', 'approved'], refund_initiated: ['refund_initiated'], refunded: ['refunded'], cancelled: ['cancelled', 'rejected'] }[requestedStatus];
  if (requestedStatus && !statusFilter) return res.status(400).json({ message: 'Invalid return status filter.' });
  res.json(await returns.listCustomerReturns(req.user.id, pool, { limit, offset, statuses: statusFilter || null, orderId: req.query.orderId }));
});

exports.createReturn = asyncHandler(async (req, res) => {
  res.status(201).json(await returns.createReturn(req.user.id, req.body));
});

exports.getReturnEligibility = asyncHandler(async (req, res) => {
  res.json(await returns.getEligibility(req.user.id, req.params.orderId));
});

exports.getReturn = asyncHandler(async (req, res) => {
  const row = await returns.findReturn(pool, req.params.returnId, req.user.id);
  if (!row) return res.status(404).json({ message: 'Return request not found.' });
  res.json(returns.formatReturn(row));
});
exports.cancelReturn = asyncHandler(async (req, res) => {
  const row = await returns.findReturn(pool, req.params.returnId, req.user.id);
  if (!row) return res.status(404).json({ message: 'Return request not found.' });
  if (!['requested', 'return_created', 'shiprocket_failed'].includes(row.status)) {
    return res.status(409).json({ message: 'This return can no longer be cancelled because return initiation has started.' });
  }
  res.json(await returns.rejectReturn(req.params.returnId, {
    database: pool, confirmedNoRemote: !row.shiprocket_return_order_id
  }));
});

exports.getCodRefundDestination = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await codRefunds.getCustomer(req.user.id, req.params.returnId));
});

exports.saveCodRefundDestination = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await codRefunds.submit(req.user.id, req.params.returnId, req.body));
});

// ── Credits ───────────────────────────────────────────────────────────────────

exports.getCredits = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT balance FROM credit_accounts WHERE user_id = $1', [req.user.id]
  );
  res.json({ balance: rows[0] ? Number(rows[0].balance) : 0 });
});

exports.getCreditTransactions = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows.map(r => ({
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    reason: r.reason,
    referenceType: r.reference_type || null,
    referenceId: r.reference_id || null,
    expiresAt: r.expires_at || null,
    createdAt: r.created_at
  })));
});
