const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { shiprocket, shippingError } = require('../config/shiprocket');
const { getRazorpay } = require('../config/razorpay');
const emails = require('./transactionalEmailService');
const ledger = require('./financialLedgerService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = [
  'requested', 'return_created', 'pickup_scheduled', 'picked_up', 'in_transit',
  'received', 'approved', 'refund_initiated', 'refunded', 'shiprocket_failed', 'pickup_failed'
];
const RETURN_REASONS = Object.freeze([
  { code: 'size_issue', label: 'Size issue' },
  { code: 'product_damaged', label: 'Product damaged' },
  { code: 'wrong_item', label: 'Wrong item received' },
  { code: 'quality_issue', label: 'Quality issue' },
  { code: 'changed_mind', label: 'Changed mind' },
  { code: 'other', label: 'Other' }
]);
const REASON_CODES = new Set(RETURN_REASONS.map(reason => reason.code));
const NO_EMAILS = {
  returnRequested: async () => {}, returnFailure: async () => {}, returnApproved: async () => {},
  codRefundRequired: async () => {}, refundInitiated: async () => {}, refundFailure: async () => {},
  returnPickupScheduled: async () => {}, returnPickedUp: async () => {}, returnReceived: async () => {}
};
function notificationsFor(database, override) { return override || (database === pool ? emails : NO_EMAILS); }
async function notifySafely(action) {
  try { await action(); }
  catch (error) { console.error('Return notification could not be queued.', { code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'EMAIL_QUEUE_FAILED' }); }
}

function fault(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function moneyPaise(value) {
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount < 0) throw fault(409, 'RETURN_FINANCIAL_REVIEW', 'The saved order amount needs review.');
  return amount;
}
function rupees(paise) { return (paise / 100).toFixed(2); }
function validId(value, label = 'identifier') {
  if (typeof value !== 'string' || !UUID.test(value)) throw fault(400, 'RETURN_VALIDATION', `A valid ${label} is required.`);
  return value.toLowerCase();
}
function cleanText(value, label, max, required = false) {
  if (value == null || value === '') {
    if (required) throw fault(400, 'RETURN_VALIDATION', `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw fault(400, 'RETURN_VALIDATION', `${label} must be at most ${max} characters.`);
  }
  return value.trim();
}
function normalizePhone(value, code = 'RETURN_ADDRESS_REVIEW', message = 'The saved delivery phone number needs review.') {
  let phone = String(value || '').replace(/[\s()+-]/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (!/^[6-9]\d{9}$/.test(phone)) throw fault(409, code, message);
  return phone;
}
function normalizePincode(value, code, message) {
  const pincode = String(value || '').trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) throw fault(409, code, message);
  return Number(pincode);
}

function evaluateEligibility(order, items, now = Date.now()) {
  if (!order) return { eligible: false, reason: 'ORDER_NOT_FOUND', message: 'Order not found.', returnUntil: null, items: [] };
  if (order.order_status !== 'delivered') {
    return { eligible: false, reason: 'NOT_DELIVERED', message: 'Returns are available only after delivery.', returnUntil: null, items: [] };
  }
  const deliveredAt = new Date(order.delivered_at).getTime();
  if (!order.delivered_at || !Number.isFinite(deliveredAt)) {
    console.warn('Return eligibility unavailable: missing delivered timestamp.', { orderId: order.id });
    return { eligible: false, reason: 'DELIVERY_TIME_MISSING', message: 'Delivery confirmation is still being verified.', returnUntil: null, items: [] };
  }
  const current = typeof now === 'function' ? Number(now()) : Number(now);
  const returnUntilMs = deliveredAt + RETURN_WINDOW_MS;
  if (!Number.isFinite(current) || current < deliveredAt) {
    return { eligible: false, reason: 'DELIVERY_TIME_INVALID', message: 'Delivery confirmation is still being verified.', returnUntil: new Date(returnUntilMs).toISOString(), items: [] };
  }
  const availableItems = items.map(item => ({
    orderItemId: item.id, productName: item.product_name, sku: item.sku || null,
    size: item.size || null, color: item.color || null,
    purchasedQuantity: Number(item.quantity), returnedQuantity: Number(item.returned_quantity || 0),
    remainingQuantity: Math.max(0, Number(item.quantity) - Number(item.returned_quantity || 0))
  }));
  if (current > returnUntilMs) {
    return { eligible: false, reason: 'WINDOW_CLOSED', message: 'The 7-day return window has closed.', returnUntil: new Date(returnUntilMs).toISOString(), items: availableItems };
  }
  const eligible = availableItems.some(item => item.remainingQuantity > 0);
  return {
    eligible, reason: eligible ? null : 'FULLY_RETURNED',
    message: eligible ? null : 'All purchased quantities already have a return request.',
    deliveredAt: new Date(deliveredAt).toISOString(), returnUntil: new Date(returnUntilMs).toISOString(), items: availableItems
  };
}

async function loadOrderAndItems(client, userId, orderId, lock = false) {
  const order = await client.query(
    `SELECT o.*, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.id = $1 AND o.user_id = $2 ${lock ? 'FOR UPDATE OF o' : ''}`,
    [orderId, userId]
  );
  if (!order.rows[0]) return { order: null, items: [] };
  const items = await client.query(
    `SELECT oi.*, COALESCE(SUM(ri.quantity) FILTER (WHERE rr.status = ANY($2::varchar[])), 0)::integer AS returned_quantity
     FROM order_items oi LEFT JOIN return_items ri ON ri.order_item_id = oi.id
     LEFT JOIN return_requests rr ON rr.id = ri.return_request_id
     WHERE oi.order_id = $1 GROUP BY oi.id ORDER BY oi.created_at, oi.id`,
    [orderId, ACTIVE_STATUSES]
  );
  return { order: order.rows[0], items: items.rows };
}

async function getEligibility(userId, orderId, database = pool, now = Date.now) {
  orderId = validId(orderId, 'order ID');
  const source = await loadOrderAndItems(database, userId, orderId, false);
  return { orderId, reasons: RETURN_REASONS, ...evaluateEligibility(source.order, source.items, now) };
}

// Allocate order-level discount over original item units in integer paise.
// Original shipping/COD service charges are intentionally non-refundable.
function refundableItems(order, items) {
  const normalized = items.map(item => ({ ...item, unitPaise: moneyPaise(item.unit_price), quantity: Number(item.quantity) }));
  const gross = normalized.reduce((sum, item) => sum + item.unitPaise * item.quantity, 0);
  const subtotal = moneyPaise(order.subtotal);
  const discount = moneyPaise(order.discount_amount);
  if (!gross || gross !== subtotal || discount > gross) throw fault(409, 'RETURN_FINANCIAL_REVIEW', 'The saved order totals need review before a return can be processed.');
  const shares = normalized.map((item, index) => {
    const numerator = BigInt(discount) * BigInt(item.unitPaise * item.quantity);
    return { index, floor: Number(numerator / BigInt(gross)), remainder: Number(numerator % BigInt(gross)) };
  });
  let leftover = discount - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((a, b) => b.remainder - a.remainder || String(normalized[a.index].id).localeCompare(String(normalized[b.index].id)));
  for (let index = 0; index < leftover; index += 1) shares[index % shares.length].floor += 1;
  const discountByIndex = new Map(shares.map(share => [share.index, share.floor]));
  return normalized.map((item, index) => {
    const itemDiscount = discountByIndex.get(index) || 0;
    const baseDiscount = Math.floor(itemDiscount / item.quantity);
    const extraUnits = itemDiscount % item.quantity;
    return { ...item, refundFor(offset, quantity) {
      let amount = 0;
      for (let unit = offset; unit < offset + quantity; unit += 1) amount += item.unitPaise - baseDiscount - (unit < extraUnits ? 1 : 0);
      return amount;
    } };
  });
}

function validateRequest(body = {}) {
  const orderId = validId(body.orderId, 'order ID');
  const idempotencyKey = validId(body.idempotencyKey, 'idempotency key');
  const comments = cleanText(body.comments, 'Comments', 500);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw fault(400, 'RETURN_VALIDATION', 'Select between 1 and 50 order items.');
  const seen = new Set();
  const items = body.items.map(item => {
    if (!item || typeof item !== 'object') throw fault(400, 'RETURN_VALIDATION', 'Each return item is required.');
    const orderItemId = validId(item.orderItemId, 'order item ID');
    if (seen.has(orderItemId)) throw fault(400, 'RETURN_VALIDATION', 'Each order item may be selected only once.');
    seen.add(orderItemId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw fault(400, 'RETURN_VALIDATION', 'Return quantity must be a whole number between 1 and 100.');
    if (!REASON_CODES.has(item.reason)) throw fault(400, 'RETURN_VALIDATION', 'Select a valid return reason.');
    const explanation = cleanText(item.comments, 'Reason explanation', 250, item.reason === 'other');
    return { orderItemId, quantity: item.quantity, reason: item.reason, comments: explanation };
  });
  const canonical = JSON.stringify({ orderId, items: [...items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)), comments });
  return { orderId, idempotencyKey, items, comments, requestHash: crypto.createHash('sha256').update(canonical).digest('hex') };
}
function returnNumber() { return `R-${crypto.randomUUID().replace(/-/g, '')}`; }

function formatReturn(row) {
  if (!row) return null;
  return {
    id: row.id, orderId: row.order_id, orderNumber: row.order_number || null, returnNumber: row.return_number,
    status: row.status, reason: row.reason || null, comments: row.comments || null,
    refundAmount: Number(row.refund_amount || 0), refundStatus: row.refund_status,
    shiprocketReturnOrderId: row.shiprocket_return_order_id || null, returnAwb: row.return_awb || null,
    pickupStatus: row.pickup_status || null,
    pickupDelayed: row.status === 'shiprocket_failed' || (row.status === 'requested' && row.pending_operation === 'create'),
    cancellationPending: row.pending_operation === 'cancel',
    customer: row.customer_name == null ? undefined : { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    paymentMethod: row.payment_method || null, items: row.items || [], requestedAt: row.requested_at,
    receivedAt: row.received_at || null, approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null, refundedAt: row.refunded_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function findReturn(database, id, userId = null, admin = false) {
  const params = [id];
  const owner = admin ? '' : 'AND rr.user_id = $2';
  if (!admin) params.push(userId);
  const result = await database.query(
    `SELECT rr.*, o.order_number, o.payment_method, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
       COALESCE(json_agg(json_build_object('id', ri.id, 'orderItemId', ri.order_item_id,
         'productName', oi.product_name, 'sku', oi.sku, 'size', oi.size, 'color', oi.color,
         'quantity', ri.quantity, 'reason', ri.reason, 'comments', ri.comments,
         'refundAmount', ri.refund_amount) ORDER BY ri.created_at) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
     FROM return_requests rr JOIN orders o ON o.id = rr.order_id JOIN users u ON u.id = rr.user_id
     LEFT JOIN return_items ri ON ri.return_request_id = rr.id LEFT JOIN order_items oi ON oi.id = ri.order_item_id
     WHERE rr.id = $1 ${owner} GROUP BY rr.id, o.order_number, o.payment_method, u.name, u.email, u.phone`, params
  );
  return result.rows[0] || null;
}

async function createLocalReturn(userId, input, database = pool, now = Date.now) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query('SELECT * FROM return_requests WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE', [userId, input.idempotencyKey]);
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].request_hash !== input.requestHash) throw fault(409, 'RETURN_IDEMPOTENCY_CONFLICT', 'This return attempt was already used for different items.');
      await client.query('COMMIT');
      return { row: duplicate.rows[0], created: false };
    }
    const source = await loadOrderAndItems(client, userId, input.orderId, true);
    if (!source.order) throw fault(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const eligibility = evaluateEligibility(source.order, source.items, now);
    if (!eligibility.eligible) throw fault(409, eligibility.reason, eligibility.message);
    const byId = new Map(refundableItems(source.order, source.items).map(item => [item.id, item]));
    const selected = input.items.map(item => {
      const purchased = byId.get(item.orderItemId);
      if (!purchased) throw fault(400, 'RETURN_ITEM_INVALID', 'A selected item does not belong to this order.');
      const alreadyReturned = Number(purchased.returned_quantity || 0);
      if (item.quantity > purchased.quantity - alreadyReturned) throw fault(409, 'RETURN_QUANTITY_EXCEEDED', 'Return quantity exceeds the remaining purchased quantity.');
      return { ...item, refundPaise: purchased.refundFor(alreadyReturned, item.quantity) };
    });
    const totalPaise = selected.reduce((sum, item) => sum + item.refundPaise, 0);
    const inserted = await client.query(
      `INSERT INTO return_requests
       (order_id, user_id, return_number, reason, comments, status, refund_amount, refund_status, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,'requested',$6,'pending',$7,$8) RETURNING *`,
      [input.orderId, userId, returnNumber(), selected.length === 1 ? selected[0].reason : 'multiple_items', input.comments,
        rupees(totalPaise), input.idempotencyKey, input.requestHash]
    );
    for (const item of selected) {
      await client.query(
        `INSERT INTO return_items (return_request_id, order_item_id, quantity, reason, comments, refund_amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [inserted.rows[0].id, item.orderItemId, item.quantity, item.reason, item.comments, rupees(item.refundPaise)]
      );
    }
    await client.query('COMMIT');
    return { row: inserted.rows[0], created: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

function requiredEnv(env, key, max = 255) { return cleanText(env[key], key, max, true); }
function splitName(value) { const parts = value.trim().split(/\s+/); return { first: parts.shift(), last: parts.join(' ') }; }
function indiaOrderDate(date = new Date()) { return new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' '); }

function savedLocationText(value, max, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw fault(503, 'RETURN_WAREHOUSE_NOT_CONFIGURED', 'The configured Shiprocket pickup location is incomplete.');
  }
  return value.trim();
}

async function resolveReturnWarehouse(api = shiprocket, env = process.env) {
  const configuredName = savedLocationText(env.SHIPROCKET_PICKUP_LOCATION, 100);
  const response = await api.request('/settings/company/pickup');
  const locations = response?.data?.shipping_address;
  if (!Array.isArray(locations)) {
    throw shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', 'Shiprocket did not return saved pickup locations.');
  }
  const matches = locations.filter(location => location && location.pickup_location === configuredName);
  if (matches.length !== 1) {
    throw fault(503, 'RETURN_WAREHOUSE_NOT_CONFIGURED', 'The configured Shiprocket pickup location was not found uniquely.');
  }
  const location = matches[0];
  const country = savedLocationText(location.country, 100);
  if (country.toLowerCase() !== 'india') {
    throw fault(503, 'RETURN_WAREHOUSE_NOT_CONFIGURED', 'The configured Shiprocket pickup location must be in India.');
  }
  const email = savedLocationText(location.email, 255);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw fault(503, 'RETURN_WAREHOUSE_NOT_CONFIGURED', 'The configured Shiprocket pickup location has an invalid email address.');
  }
  return {
    ...splitName(savedLocationText(location.name, 255)),
    address: savedLocationText(location.address, 255),
    address2: savedLocationText(location.address_2, 255, true),
    city: savedLocationText(location.city, 100), state: savedLocationText(location.state, 100),
    pincode: normalizePincode(location.pin_code, 'RETURN_WAREHOUSE_NOT_CONFIGURED',
      'The configured Shiprocket pickup location has an invalid pincode.'),
    email,
    phone: normalizePhone(location.phone, 'RETURN_WAREHOUSE_NOT_CONFIGURED',
      'The configured Shiprocket pickup location has an invalid phone number.')
  };
}

async function returnPayload(database, returnId, env = process.env, api = shiprocket) {
  const result = await database.query(
    `SELECT rr.id, rr.return_number, rr.refund_amount, o.payment_method, u.email AS customer_email, oa.*,
       COALESCE(json_agg(json_build_object('sku', oi.sku, 'variantId', oi.variant_id, 'id', oi.id,
         'name', oi.product_name, 'size', oi.size, 'quantity', ri.quantity, 'unitPrice', oi.unit_price,
         'refundAmount', ri.refund_amount) ORDER BY ri.created_at), '[]') AS items
     FROM return_requests rr JOIN orders o ON o.id = rr.order_id JOIN users u ON u.id = rr.user_id
     JOIN order_addresses oa ON oa.order_id = o.id JOIN return_items ri ON ri.return_request_id = rr.id
     JOIN order_items oi ON oi.id = ri.order_item_id WHERE rr.id = $1
     GROUP BY rr.id, o.id, u.email, oa.id`, [returnId]
  );
  const row = result.rows[0];
  if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  if (!row.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.customer_email)) throw fault(409, 'RETURN_CUSTOMER_EMAIL_REQUIRED', 'Add and verify an email address before pickup can be scheduled.');
  const customer = splitName(cleanText(row.full_name, 'Customer name', 255, true));
  const warehouse = await resolveReturnWarehouse(api, env);
  const items = row.items.map(item => {
    const gross = moneyPaise(item.unitPrice) * Number(item.quantity);
    const net = moneyPaise(item.refundAmount);
    return { sku: cleanText(item.sku || item.variantId || item.id, 'Item SKU', 100, true),
      name: cleanText(item.name, 'Product name', 255, true), units: Number(item.quantity),
      selling_price: Number(item.unitPrice), discount: Number(rupees(gross - net)), qc_enable: false, qc_size: item.size || '' };
  });
  const weight = Number(requiredEnv(env, 'SHIPROCKET_PACKAGE_WEIGHT_KG'));
  const length = Number(requiredEnv(env, 'SHIPROCKET_PACKAGE_LENGTH_CM'));
  const breadth = Number(requiredEnv(env, 'SHIPROCKET_PACKAGE_BREADTH_CM'));
  const height = Number(requiredEnv(env, 'SHIPROCKET_PACKAGE_HEIGHT_CM'));
  if (![weight, length, breadth, height].every(value => Number.isFinite(value) && value > 0)) throw fault(503, 'RETURN_WAREHOUSE_NOT_CONFIGURED', 'Return package measurements are not configured.');
  return {
    order_id: row.return_number, order_date: indiaOrderDate(),
    pickup_customer_name: customer.first, pickup_last_name: customer.last,
    pickup_address: cleanText(row.address_line1, 'Pickup address', 255, true),
    pickup_address_2: [row.address_line2, row.landmark].filter(Boolean).join(', ').slice(0, 255),
    pickup_city: cleanText(row.city, 'Pickup city', 100, true), pickup_state: cleanText(row.state, 'Pickup state', 100, true),
    pickup_country: 'India', pickup_pincode: normalizePincode(row.postal_code, 'RETURN_ADDRESS_REVIEW', 'The saved delivery pincode needs review.'), pickup_email: row.customer_email,
    pickup_phone: normalizePhone(row.phone), pickup_isd_code: '91',
    shipping_customer_name: warehouse.first, shipping_last_name: warehouse.last,
    shipping_address: warehouse.address, shipping_address_2: warehouse.address2,
    shipping_city: warehouse.city, shipping_state: warehouse.state, shipping_country: 'India',
    shipping_pincode: warehouse.pincode, shipping_email: warehouse.email,
    shipping_phone: warehouse.phone, shipping_isd_code: '91',
    order_items: items, payment_method: 'PREPAID',
    total_discount: Number(rupees(items.reduce((sum, item) => sum + moneyPaise(item.discount), 0))),
    sub_total: Number(rupees(items.reduce((sum, item) => sum + moneyPaise(item.selling_price) * item.units, 0))),
    length, breadth, height, weight
  };
}

function providerIdentifiers(result) {
  const data = result?.data && typeof result.data === 'object' ? result.data : result;
  const orderId = Number(data?.order_id ?? data?.return_order_id);
  const shipmentId = Number(data?.shipment_id ?? data?.return_shipment_id);
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(shipmentId) || shipmentId < 1) throw shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', 'The return provider did not confirm the reverse shipment.', true);
  return { orderId, shipmentId, awb: data.awb_code || data.awb || null, pickupStatus: data.pickup_status || data.pickup?.status || null };
}

async function provisionReturn(returnId, { database = pool, api = shiprocket, env = process.env, notifications = null } = {}) {
  const notifier = notificationsFor(database, notifications);
  returnId = validId(returnId, 'return ID');
  const claim = await database.query(
    `UPDATE return_requests SET pending_operation = 'create', operation_started_at = NOW(), attempt_count = attempt_count + 1,
       last_error_code = NULL, updated_at = NOW() WHERE id = $1 AND shiprocket_return_shipment_id IS NULL
       AND pending_operation IS NULL AND status IN ('requested','shiprocket_failed') RETURNING id`, [returnId]
  );
  if (!claim.rows.length) return findReturn(database, returnId, null, true);
  try {
    const payload = await returnPayload(database, returnId, env, api);
    // Create only the return order. Courier assignment, AWB generation and
    // pickup scheduling remain deliberate actions in the Shiprocket panel.
    const remote = providerIdentifiers(await api.request('/orders/create/return', { method: 'POST', body: payload }));
    await database.query(
      `UPDATE return_requests SET shiprocket_return_order_id = $1, shiprocket_return_shipment_id = $2,
         return_awb = $3, pickup_status = NULL, status = 'return_created', pending_operation = NULL,
         operation_started_at = NULL, last_error_code = NULL, updated_at = NOW() WHERE id = $4 AND pending_operation = 'create'`,
      [remote.orderId, remote.shipmentId, remote.awb ? String(remote.awb) : null, returnId]
    );
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'RETURN_PROVIDER_FAILED';
    const uncertain = Boolean(error.uncertain);
    await database.query(
      `UPDATE return_requests SET status = $1, last_error_code = $2,
         pending_operation = CASE WHEN $3 THEN pending_operation ELSE NULL END,
         operation_started_at = CASE WHEN $3 THEN operation_started_at ELSE NULL END, updated_at = NOW() WHERE id = $4`,
      [uncertain ? 'requested' : 'shiprocket_failed', code, uncertain, returnId]
    ).catch(() => {});
    await notifySafely(() => notifier.returnFailure(returnId, code));
  }
  return findReturn(database, returnId, null, true);
}

async function createReturn(userId, body = {}, database = pool, dependencies = {}) {
  const notifier = notificationsFor(database, dependencies.notifications);
  const input = validateRequest(body);
  const local = await createLocalReturn(userId, input, database, dependencies.now || Date.now);
  if (local.created) await provisionReturn(local.row.id, { database, api: dependencies.api || shiprocket,
    env: dependencies.env || process.env, notifications: notifier });
  await notifySafely(() => notifier.returnRequested(local.row.id));
  return formatReturn(await findReturn(database, local.row.id, userId));
}
async function listCustomerReturns(userId, database = pool, { limit = 100, offset = 0 } = {}) {
  const result = await database.query('SELECT id FROM return_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset]);
  return Promise.all(result.rows.map(async row => formatReturn(await findReturn(database, row.id, userId))));
}
async function listAdminReturns(database = pool, { limit = 100, offset = 0 } = {}) {
  const result = await database.query('SELECT id FROM return_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
  return Promise.all(result.rows.map(async row => formatReturn(await findReturn(database, row.id, null, true))));
}

async function rejectReturn(returnId, { database = pool, api = shiprocket, confirmedNoRemote = false } = {}) {
  returnId = validId(returnId, 'return ID');
  const client = await database.connect();
  let remoteOrderId = null;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
    const row = found.rows[0];
    if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (row.inventory_restored_at || ['approved','refund_initiated','refunded','rejected','cancelled'].includes(row.status)) {
      throw fault(409, 'RETURN_TRANSITION_INVALID', 'This return can no longer be rejected.');
    }
    if (['picked_up','in_transit'].includes(row.status)) {
      throw fault(409, 'RETURN_CANCELLATION_UNAVAILABLE', 'This return is already moving and cannot be cancelled. Review it after warehouse receipt.');
    }
    if (row.status === 'received') {
      await client.query(
        `UPDATE return_requests SET status = 'rejected', rejected_at = NOW(), refund_status = 'not_applicable',
           pending_operation = NULL, operation_started_at = NULL, updated_at = NOW() WHERE id = $1`, [returnId]
      );
      await client.query('COMMIT');
      return formatReturn(await findReturn(database, returnId, null, true));
    }

    remoteOrderId = Number(row.shiprocket_return_order_id);
    const hasRemoteOrder = Number.isSafeInteger(remoteOrderId) && remoteOrderId > 0;
    if (!hasRemoteOrder) {
      if (row.status === 'return_created' || row.status === 'pickup_scheduled' || row.status === 'pickup_failed') {
        throw fault(409, 'RETURN_CANCELLATION_REVIEW', 'The Shiprocket return identifier is missing. Review the return before rejecting it.');
      }
      if (row.pending_operation === 'create' && !confirmedNoRemote) {
        throw fault(409, 'RETURN_REMOTE_CONFIRMATION_REQUIRED', 'Confirm that no matching return exists in Shiprocket before rejecting this request.');
      }
      if (!['requested','shiprocket_failed'].includes(row.status)) {
        throw fault(409, 'RETURN_TRANSITION_INVALID', 'This return can no longer be rejected.');
      }
      await client.query(
        `UPDATE return_requests SET status = 'rejected', rejected_at = NOW(), refund_status = 'not_applicable',
           pending_operation = NULL, operation_started_at = NULL, updated_at = NOW() WHERE id = $1`, [returnId]
      );
      await client.query('COMMIT');
      return formatReturn(await findReturn(database, returnId, null, true));
    }

    if (!['return_created','pickup_scheduled','pickup_failed'].includes(row.status) || row.pending_operation) {
      throw fault(409, row.pending_operation === 'cancel' ? 'RETURN_CANCELLATION_RECONCILIATION_REQUIRED' : 'RETURN_TRANSITION_INVALID',
        row.pending_operation === 'cancel' ? 'Cancellation is already pending reconciliation.' : 'This return cannot be cancelled in its current state.');
    }
    await client.query(
      `UPDATE return_requests SET pending_operation = 'cancel', operation_started_at = NOW(),
         last_error_code = NULL, updated_at = NOW() WHERE id = $1`, [returnId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }

  try {
    await api.request('/orders/cancel', {
      method: 'POST', body: { ids: [remoteOrderId] }, acceptEmptyResponse: true
    });
    await database.query(
      `UPDATE return_requests SET status = 'cancelled', refund_status = 'not_applicable',
         pending_operation = NULL, operation_started_at = NULL, last_error_code = NULL, updated_at = NOW()
       WHERE id = $1 AND pending_operation = 'cancel'`, [returnId]
    );
  } catch (error) {
    const uncertain = Boolean(error.uncertain);
    await database.query(
      `UPDATE return_requests SET pending_operation = CASE WHEN $2 THEN pending_operation ELSE NULL END,
         operation_started_at = CASE WHEN $2 THEN operation_started_at ELSE NULL END,
         last_error_code = $3, updated_at = NOW() WHERE id = $1 AND pending_operation = 'cancel'`,
      [returnId, uncertain, uncertain ? 'RETURN_CANCELLATION_RECONCILIATION_REQUIRED' : (error.code || 'RETURN_CANCELLATION_FAILED')]
    ).catch(() => {});
    throw fault(409, uncertain ? 'RETURN_CANCELLATION_RECONCILIATION_REQUIRED' : 'RETURN_CANCELLATION_FAILED',
      uncertain ? 'Check Shiprocket before taking another action on this return.' : 'Shiprocket did not cancel this return. No local status was changed.');
  }
  return formatReturn(await findReturn(database, returnId, null, true));
}

async function approveReturn(returnId, database = pool, notifications = null) {
  const notifier = notificationsFor(database, notifications);
  returnId = validId(returnId, 'return ID');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT rr.*, o.payment_method FROM return_requests rr JOIN orders o ON o.id = rr.order_id
       WHERE rr.id = $1 FOR UPDATE OF rr`, [returnId]
    );
    const row = found.rows[0];
    if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (!['received','approved','refund_initiated','refunded'].includes(row.status)) throw fault(409, 'RETURN_TRANSITION_INVALID', 'The return must be received before it can be approved.');
    if (!row.inventory_restored_at) {
      const items = await client.query(
        `SELECT oi.variant_id, SUM(ri.quantity)::integer AS quantity FROM return_items ri
         JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_request_id = $1
         GROUP BY oi.variant_id ORDER BY oi.variant_id`, [returnId]
      );
      if (!items.rows.length || items.rows.some(item => !item.variant_id)) throw fault(409, 'RETURN_INVENTORY_REVIEW', 'Returned inventory needs manual review.');
      for (const item of items.rows) {
        const restored = await client.query('UPDATE product_variants SET stock = stock + $1, updated_at = NOW() WHERE id = $2 RETURNING id', [item.quantity, item.variant_id]);
        if (!restored.rows.length) throw fault(409, 'RETURN_INVENTORY_REVIEW', 'Returned inventory needs manual review.');
      }
      await client.query(
        `UPDATE return_requests SET inventory_restored_at = NOW(), status = 'approved', approved_at = COALESCE(approved_at, NOW()),
         refund_status = CASE WHEN $2 = 'cod' THEN 'manual_required' ELSE 'pending' END, updated_at = NOW() WHERE id = $1`,
        [returnId, row.payment_method]
      );
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  await notifySafely(() => notifier.returnApproved(returnId));
  return formatReturn(await findReturn(database, returnId, null, true));
}

async function initiateRefund(returnId, { database = pool, gateway = getRazorpay, notifications = null } = {}) {
  const notifier = notificationsFor(database, notifications);
  returnId = validId(returnId, 'return ID');
  const client = await database.connect();
  let row;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT rr.*, o.payment_method, o.razorpay_payment_id FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id WHERE rr.id = $1 FOR UPDATE OF rr`, [returnId]
    );
    row = found.rows[0];
    if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (row.payment_method === 'cod') {
      await client.query("UPDATE return_requests SET refund_status = 'manual_required', updated_at = NOW() WHERE id = $1", [returnId]);
      await client.query('COMMIT');
      await notifySafely(() => notifier.codRefundRequired(returnId));
      return formatReturn(await findReturn(database, returnId, null, true));
    }
    if (row.status === 'refunded' || row.refund_status === 'refunded') { await client.query('COMMIT'); return formatReturn(await findReturn(database, returnId, null, true)); }
    if (row.status !== 'approved' || row.refund_status !== 'pending' || row.pending_operation) throw fault(409, 'RETURN_TRANSITION_INVALID', 'This return is not ready for a refund.');
    if (!row.razorpay_payment_id) throw fault(409, 'RETURN_PAYMENT_REVIEW', 'The original payment needs manual review.');
    await client.query(
      `UPDATE return_requests SET status = 'refund_initiated', refund_status = 'processing', pending_operation = 'refund',
       operation_started_at = NOW(), refund_initiated_at = NOW(), updated_at = NOW() WHERE id = $1`, [returnId]
    );
    await ledger.refund(client, {
      orderId: row.order_id, returnId, amount: row.refund_amount, status: 'PENDING',
      eventType: 'REFUND_INITIATED', occurredAt: new Date()
    });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  try {
    const { razorpay } = gateway();
    const refund = await razorpay.payments.refund(row.razorpay_payment_id, {
      amount: moneyPaise(row.refund_amount), speed: 'normal',
      notes: { return_request_id: returnId, return_number: row.return_number }, receipt: row.return_number
    });
    if (!refund?.id || !/^rfnd_[a-zA-Z0-9]+$/.test(refund.id)) throw fault(502, 'REFUND_INVALID_RESPONSE', 'The payment provider did not confirm the refund request.');
    const updateClient = await database.connect();
    try {
      await updateClient.query('BEGIN');
      await updateClient.query(
        `UPDATE return_requests SET razorpay_refund_id = $1, pending_operation = NULL, operation_started_at = NULL,
         last_error_code = NULL, updated_at = NOW() WHERE id = $2 AND pending_operation = 'refund'`, [refund.id, returnId]
      );
      await ledger.refund(updateClient, {
        orderId: row.order_id, returnId, refundId: refund.id, amount: row.refund_amount,
        status: 'PENDING', eventType: 'REFUND_ACCEPTED', occurredAt: new Date()
      });
      await updateClient.query('COMMIT');
    } catch (updateError) {
      await updateClient.query('ROLLBACK').catch(() => {});
      throw updateError;
    } finally { updateClient.release(); }
    await notifySafely(() => notifier.refundInitiated(returnId, refund.id));
  } catch (error) {
    const definitiveFailure = Number(error.statusCode) >= 400 && Number(error.statusCode) < 500;
    const failureClient = await database.connect();
    try {
      await failureClient.query('BEGIN');
      await failureClient.query("UPDATE return_requests SET last_error_code = 'REFUND_RECONCILIATION_REQUIRED', updated_at = NOW() WHERE id = $1", [returnId]);
      await ledger.refund(failureClient, {
        orderId: row.order_id, returnId, amount: row.refund_amount,
        status: definitiveFailure ? 'FAILED' : 'PENDING',
        eventType: definitiveFailure ? 'REFUND_REJECTED' : 'REFUND_RECONCILIATION_REQUIRED',
        description: definitiveFailure ? 'Razorpay refund initiation failed' : 'Razorpay refund requires reconciliation'
      });
      await failureClient.query('COMMIT');
    } catch { await failureClient.query('ROLLBACK').catch(() => {}); }
    finally { failureClient.release(); }
    await notifySafely(() => notifier.refundFailure(returnId, error.code || 'REFUND_RECONCILIATION_REQUIRED'));
    throw fault(409, 'REFUND_RECONCILIATION_REQUIRED', 'Check Razorpay before retrying this refund.');
  }
  return formatReturn(await findReturn(database, returnId, null, true));
}

const STATUS_RANK = { requested: 0, return_created: 1, pickup_scheduled: 2, picked_up: 3, in_transit: 4, received: 5 };

// Shiprocket publishes two different numeric status namespaces. Tracking
// webhooks use shipment_status_id/current_status_id, while return-order
// responses can use status/status_code. Keep them separate because values such
// as 22 and 48 mean different things in each namespace.
const SHIPMENT_STATUS = new Map([
  [1, 'return_created'], [2, 'return_created'], [5, 'return_created'], [11, 'return_created'], [52, 'return_created'],
  [3, 'pickup_scheduled'], [4, 'pickup_scheduled'], [15, 'pickup_scheduled'], [19, 'pickup_scheduled'], [27, 'pickup_scheduled'],
  [42, 'picked_up'],
  [6, 'in_transit'], [18, 'in_transit'], [38, 'in_transit'], [46, 'in_transit'],
  [7, 'received'], [48, 'received'],
  [13, 'pickup_failed'], [20, 'pickup_failed'],
  [8, 'cancelled'], [16, 'cancelled'], [45, 'cancelled']
]);
const RETURN_ORDER_STATUS = new Map([
  [21, 'return_created'],
  [22, 'pickup_scheduled'], [23, 'pickup_scheduled'], [28, 'pickup_scheduled'], [31, 'pickup_scheduled'], [47, 'pickup_scheduled'], [70, 'pickup_scheduled'],
  [32, 'picked_up'], [51, 'picked_up'],
  [25, 'in_transit'], [48, 'in_transit'], [90, 'in_transit'],
  [26, 'received'], [58, 'received'], [68, 'received'], [81, 'received'],
  [24, 'pickup_failed'], [33, 'pickup_failed'], [40, 'pickup_failed'], [49, 'pickup_failed'], [50, 'pickup_failed'], [57, 'pickup_failed'],
  [27, 'cancelled'], [29, 'cancelled'], [30, 'cancelled'], [54, 'cancelled']
]);

function numericStatus(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function webhookStatusLabel(payload) {
  const value = payload.shipment_status ?? payload.current_status ?? payload.status_label ??
    payload['sr-status-label'] ?? payload.sr_status_label ??
    (typeof payload.status === 'string' && numericStatus(payload.status) == null ? payload.status : '');
  return String(value || '').trim().slice(0, 100);
}

function mappedStatusLabel(value) {
  const label = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return null;
  if (/\bcancell?ed\b|cancellation requested/.test(label)) return 'cancelled';
  if (/pickup (error|exception)|return undelivered|\blost\b|\bdamaged\b/.test(label)) return 'pickup_failed';
  if (/return delivered|reached warehouse|return acknowledged|processed at warehouse|^delivered$/.test(label)) return 'received';
  if (/return picked up|^picked up$/.test(label)) return 'picked_up';
  if (/return in transit|^in transit$|return out for delivery|^shipped$|reached back at seller city/.test(label)) return 'in_transit';
  if (/return initiated|return pickup (queued|generated|rescheduled)|return out for pickup|pickup (scheduled|generated|queued|rescheduled|booked)|^out for pickup$/.test(label)) return 'pickup_scheduled';
  if (/return pending|^new$|shipment booked/.test(label)) return 'return_created';
  return null;
}

function mappedWebhookStatus(payload) {
  const labelStatus = mappedStatusLabel(webhookStatusLabel(payload));
  if (labelStatus) return labelStatus;
  const shipmentCodes = [payload.shipment_status_id, payload.current_status_id, payload.sr_status, payload['sr-status']];
  for (const value of shipmentCodes) {
    const code = numericStatus(value);
    if (code != null && SHIPMENT_STATUS.has(code)) return SHIPMENT_STATUS.get(code);
  }
  for (const value of [payload.status_code, payload.status]) {
    const code = numericStatus(value);
    if (code != null && RETURN_ORDER_STATUS.has(code)) return RETURN_ORDER_STATUS.get(code);
  }
  return null;
}
function secureEqual(expected, received) {
  if (typeof expected !== 'string' || !expected || typeof received !== 'string') return false;
  const a = Buffer.from(expected); const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function processShiprocketWebhook(payload, headers, database = pool, env = process.env, notifications = null) {
  const notifier = notificationsFor(database, notifications);
  if (!secureEqual(env.SHIPROCKET_WEBHOOK_SECRET, headers['x-api-key'])) throw fault(401, 'WEBHOOK_UNAUTHORIZED', 'Invalid webhook token.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fault(400, 'WEBHOOK_INVALID', 'Invalid webhook body.');
  const awb = payload.awb ? String(payload.awb).slice(0, 100) : null;
  const providerOrderId = Number(payload.sr_order_id);
  const channelOrderId = typeof payload.order_id === 'string' ? payload.order_id.slice(0, 50) : null;
  const next = mappedWebhookStatus(payload);
  if (!next || (!awb && !Number.isSafeInteger(providerOrderId) && !channelOrderId)) return { ignored: true, duplicate: false };
  const eventId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query('INSERT INTO return_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
    if (!claim.rows.length) { await client.query('COMMIT'); return { ignored: false, duplicate: true }; }
    const found = await client.query(
      `SELECT * FROM return_requests WHERE ($1::text IS NOT NULL AND return_awb = $1)
       OR ($2::bigint IS NOT NULL AND shiprocket_return_order_id = $2)
       OR ($3::text IS NOT NULL AND return_number = $3) FOR UPDATE`,
      [awb, Number.isSafeInteger(providerOrderId) ? providerOrderId : null, channelOrderId]
    );
    const row = found.rows[0];
    if (!row) { await client.query('COMMIT'); return { ignored: true, duplicate: false }; }
    const terminal = ['rejected','cancelled','refunded'].includes(row.status);
    const canAdvance = next === 'cancelled' || next === 'pickup_failed' || (STATUS_RANK[next] != null && STATUS_RANK[next] >= (STATUS_RANK[row.status] ?? -1));
    if (!terminal && canAdvance) {
      const providerLabel = webhookStatusLabel(payload);
      await client.query(
        `UPDATE return_requests SET status = $1, provider_status = $2, pickup_status = $3,
         return_awb = COALESCE(return_awb, $4), received_at = CASE WHEN $1 = 'received' THEN COALESCE(received_at, NOW()) ELSE received_at END,
         pending_operation = CASE WHEN $1 = 'cancelled' AND pending_operation = 'cancel' THEN NULL ELSE pending_operation END,
         operation_started_at = CASE WHEN $1 = 'cancelled' AND pending_operation = 'cancel' THEN NULL ELSE operation_started_at END,
         refund_status = CASE WHEN $1 = 'cancelled' THEN 'not_applicable' ELSE refund_status END,
         updated_at = NOW() WHERE id = $5`,
        [next, providerLabel, providerLabel.slice(0, 50), awb, row.id]
      );
    }
    await client.query('UPDATE return_webhook_events SET return_request_id = $1 WHERE event_id = $2', [row.id, eventId]);
    await client.query('COMMIT');
    if (!terminal && canAdvance && next !== row.status) {
      if (next === 'pickup_scheduled') await notifySafely(() => notifier.returnPickupScheduled(row.id));
      if (next === 'picked_up') await notifySafely(() => notifier.returnPickedUp(row.id));
      if (next === 'received') await notifySafely(() => notifier.returnReceived(row.id));
      if (next === 'pickup_failed') await notifySafely(() => notifier.returnFailure(row.id, 'RETURN_PICKUP_FAILED'));
    }
    return { ignored: false, duplicate: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

module.exports = {
  RETURN_REASONS, RETURN_WINDOW_MS, ACTIVE_STATUSES, evaluateEligibility, refundableItems,
  validateRequest, createLocalReturn, getEligibility, createReturn, provisionReturn, listCustomerReturns, listAdminReturns,
  findReturn, formatReturn, approveReturn, rejectReturn, initiateRefund,
  mappedWebhookStatus, processShiprocketWebhook, returnPayload, resolveReturnWarehouse
};
