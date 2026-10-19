const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { shiprocket, shippingError } = require('../config/shiprocket');
const { getRazorpay } = require('../config/razorpay');
const emails = require('./transactionalEmailService');
const ledger = require('./financialLedgerService');
const codRefunds = require('./codRefundService');
const inventory = require('./inventoryService');
const afterSalesOrders = require('./afterSalesOrderService');
const { packageDetails, productTaxPercent, productNameWithSize } = require('./shippingMapping');
const { outboundStage, adminCategory, ADMIN_CATEGORY_SQL } = require('./returnWorkflow');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFECT_WINDOW_MS = 48 * 60 * 60 * 1000;
const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RETURN_TYPES = Object.freeze({ return: 'return', defect: 'defect', replacement: 'replacement' });
const DEFECT_REASONS = new Set(['product_damaged', 'wrong_item', 'quality_issue']);
const NORMAL_REASONS = new Set(['size_issue', 'changed_mind', 'other']);
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

function fault(status, code, message, details = null) { return Object.assign(new Error(message), { status, code, details }); }
function moneyPaise(value) {
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount < 0) throw fault(409, 'RETURN_FINANCIAL_REVIEW', 'The saved order amount needs review.');
  return amount;
}
function rupees(paise) { return (paise / 100).toFixed(2); }
function returnShippingDeductionPaise(environment = process.env) {
  const raw = environment.RETURN_SHIPPING_DEDUCTION_PAISE;
  if (raw == null || raw === '') return 15000;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) throw fault(503, 'RETURN_POLICY_CONFIG_INVALID', 'Return policy configuration needs review.');
  return value;
}
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

function evaluateEligibility(order, items, now = Date.now(), overrideTypes = []) {
  if (order?.order_type && order.order_type !== 'normal') return { eligible: false, reason: 'AFTER_SALES_ORDER', message: 'Track this shipment in the original return request.', items: [] };
  if (!order) return { eligible: false, reason: 'ORDER_NOT_FOUND', message: 'Order not found.', returnUntil: null, requestTypes: [], defectReportingEnded: false, items: [] };
  if (order.order_status !== 'delivered') {
    return { eligible: false, reason: 'NOT_DELIVERED', message: 'Returns are available only after delivery.', returnUntil: null, requestTypes: [], defectReportingEnded: false, items: [] };
  }
  const deliveredAt = new Date(order.delivered_at).getTime();
  if (!order.delivered_at || !Number.isFinite(deliveredAt)) {
    console.warn('Return eligibility unavailable: missing delivered timestamp.', { orderId: order.id });
    return { eligible: false, reason: 'DELIVERY_TIME_MISSING', message: 'Delivery confirmation is still being verified.', returnUntil: null, requestTypes: [], defectReportingEnded: false, items: [] };
  }
  const current = typeof now === 'function' ? Number(now()) : Number(now);
  const returnUntilMs = deliveredAt + RETURN_WINDOW_MS;
  const defectUntilMs = deliveredAt + DEFECT_WINDOW_MS;
  if (!Number.isFinite(current) || current < deliveredAt) {
    return { eligible: false, reason: 'DELIVERY_TIME_INVALID', message: 'Delivery confirmation is still being verified.', returnUntil: new Date(returnUntilMs).toISOString(), requestTypes: [], defectReportingEnded: false, items: [] };
  }
  const availableItems = items.map(item => ({
    orderItemId: item.id, productName: item.product_name, sku: item.sku || null,
    size: item.size || null, color: item.color || null,
    replacementSizes: Array.isArray(item.replacement_sizes) ? item.replacement_sizes : [],
    purchasedQuantity: Number(item.quantity), returnedQuantity: Number(item.returned_quantity || 0),
    alreadyRequested: Number(item.returned_quantity || 0) >= Number(item.quantity),
    remainingQuantity: Math.max(0, Number(item.quantity) - Number(item.returned_quantity || 0))
  }));
  const hasExistingRequest = Boolean(order.has_existing_return_request) || availableItems.some(item => item.returnedQuantity > 0);
  const override = new Set(overrideTypes || []);
  const normalEligible = current <= returnUntilMs || override.has(RETURN_TYPES.return);
  const replacementEligible = current <= returnUntilMs || override.has(RETURN_TYPES.replacement);
  const defectEligible = current <= defectUntilMs || override.has(RETURN_TYPES.defect);
  const requestTypes = [
    { code: RETURN_TYPES.defect, label: 'Report a defect', eligible: defectEligible,
      message: defectEligible ? 'Report a defect \u2014 available within 2 days of delivery.' : 'Defect reporting window ended. Contact support for late defect claims.' },
    { code: RETURN_TYPES.return, label: 'Return item', eligible: normalEligible,
      message: normalEligible ? 'Return item \u2014 available within 7 days of delivery.' : 'The 7-day return window has closed.' },
    { code: RETURN_TYPES.replacement, label: 'Replace size', eligible: replacementEligible,
      message: replacementEligible ? 'Replace size \u2014 available within 7 days of delivery.' : 'The 7-day size replacement window has closed.' }
  ];
  const available = availableItems.some(item => item.remainingQuantity > 0);
  const eligible = available && requestTypes.some(type => type.eligible);
  if (!eligible) {
    return { eligible: false, hasExistingRequest, reason: available ? 'WINDOW_CLOSED' : 'FULLY_RETURNED',
      message: available ? 'The return and replacement windows have closed.' : 'All products already have a return or replacement request.',
      deliveredAt: new Date(deliveredAt).toISOString(), returnUntil: new Date(returnUntilMs).toISOString(), defectUntil: new Date(defectUntilMs).toISOString(),
      defectReportingEnded: current > defectUntilMs && !override.has(RETURN_TYPES.defect), requestTypes, items: availableItems };
  }
  return {
    eligible, hasExistingRequest, reason: null, message: null,
    deliveredAt: new Date(deliveredAt).toISOString(), returnUntil: new Date(returnUntilMs).toISOString(), defectUntil: new Date(defectUntilMs).toISOString(),
    defectReportingEnded: current > defectUntilMs && !override.has(RETURN_TYPES.defect), requestTypes, items: availableItems
  };
}

async function loadOrderAndItems(client, userId, orderId, lock = false) {
  const order = await client.query(
    `SELECT o.*, u.email AS customer_email,
       EXISTS (SELECT 1 FROM return_requests rr WHERE rr.order_id = o.id AND rr.status = ANY($3::varchar[])) AS has_existing_return_request,
       EXISTS (SELECT 1 FROM return_requests rr WHERE rr.order_id = o.id) AS has_return_history
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.id = $1 AND o.user_id = $2 ${lock ? 'FOR UPDATE OF o' : ''}`,
    [orderId, userId, ACTIVE_STATUSES]
  );
  if (!order.rows[0]) return { order: null, items: [] };
  const items = await client.query(
    `SELECT oi.*, COALESCE(SUM(ri.quantity) FILTER (WHERE rr.status = ANY($2::varchar[])), 0)::integer AS returned_quantity,
       COALESCE((SELECT array_agg(s.name ORDER BY s.name) FROM product_size_details psd JOIN sizes s ON s.id = psd.size_id
         WHERE psd.product_id = oi.product_id AND psd.is_active = TRUE), ARRAY[]::varchar[]) AS replacement_sizes
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
  const overrides = source.order ? await database.query(`SELECT request_type FROM return_eligibility_overrides
    WHERE order_id = $1 AND user_id = $2 AND used_at IS NULL`, [orderId, userId]) : { rows: [] };
  const eligibility = evaluateEligibility(source.order, source.items, now, overrides.rows.map(row => row.request_type));
  const refundItems = source.order && source.items.length ? refundableItems(source.order, source.items) : [];
  eligibility.items = eligibility.items.map(item => {
    const original = refundItems.find(row => row.id === item.orderItemId);
    return { ...item, refundableUnitAmounts: original ? Array.from({ length: item.remainingQuantity }, (_, offset) =>
      Number(rupees(original.refundFor(item.returnedQuantity + offset, 1)))) : [] };
  });
  const permitted = new Set(eligibility.requestTypes?.filter(type => type.eligible).map(type => type.code) || []);
  return { orderId, shippingDeductionAmount: Number(rupees(returnShippingDeductionPaise())), hasReturnHistory: Boolean(source.order?.has_return_history || eligibility.hasExistingRequest), reasons: RETURN_REASONS.filter(reason =>
    (DEFECT_REASONS.has(reason.code) && permitted.has(RETURN_TYPES.defect)) ||
    (NORMAL_REASONS.has(reason.code) && permitted.has(RETURN_TYPES.return)) ||
    (reason.code === 'size_issue' && permitted.has(RETURN_TYPES.replacement))), ...eligibility };
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
  const submittedReasons = Array.isArray(body.items) ? body.items.map(item => item?.reason) : [];
  // Preserve the pre-policy API contract while still applying the stricter 48-hour
  // window to legacy clients that submit only a defect reason.
  const requestType = body.requestType || (submittedReasons.length && submittedReasons.every(reason => DEFECT_REASONS.has(reason))
    ? RETURN_TYPES.defect : RETURN_TYPES.return);
  if (!Object.values(RETURN_TYPES).includes(requestType)) throw fault(400, 'RETURN_VALIDATION', 'Select a valid request type.');
  const legacyReplacementSize = requestType === RETURN_TYPES.replacement ? cleanText(body.replacementSize, 'Replacement size', 50) : null;
  const comments = cleanText(body.comments, 'Comments', 500);
  const refundDestination = body.refundDestination ? codRefunds.validateDestination(body.refundDestination) : null;
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw fault(400, 'RETURN_VALIDATION', 'Select between 1 and 50 order items.');
  const seen = new Set();
  const items = body.items.map(item => {
    if (!item || typeof item !== 'object') throw fault(400, 'RETURN_VALIDATION', 'Each return item is required.');
    const orderItemId = validId(item.orderItemId, 'order item ID');
    if (seen.has(orderItemId)) throw fault(400, 'RETURN_VALIDATION', 'Each order item may be selected only once.');
    seen.add(orderItemId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw fault(400, 'RETURN_VALIDATION', 'Return quantity must be a whole number between 1 and 100.');
    if (!REASON_CODES.has(item.reason)) throw fault(400, 'RETURN_VALIDATION', 'Select a valid return reason.');
    const explanation = cleanText(item.comments, 'Reason explanation', 250, item.reason === 'other' || DEFECT_REASONS.has(item.reason));
    const replacementSize = requestType === RETURN_TYPES.replacement
      ? cleanText(item.replacementSize || legacyReplacementSize, 'Replacement size', 50, true) : null;
    let photoIds;
    if (requestType === RETURN_TYPES.defect) {
      if (!Array.isArray(item.photoIds) || item.photoIds.length < 1 || item.photoIds.length > 2) throw fault(400, 'DEFECT_PHOTOS_REQUIRED', 'Upload at least one photo and at most two photos for every defective item.');
      photoIds = item.photoIds.map(id => validId(id, 'defect photo ID'));
      if (new Set(photoIds).size !== photoIds.length) throw fault(400, 'DEFECT_PHOTOS_REQUIRED', 'Choose different photos for this product.');
    }
    return { orderItemId, quantity: item.quantity, reason: item.reason, comments: explanation, replacementSize,
      ...(photoIds ? { photoIds } : {}) };
  });
  if (requestType === RETURN_TYPES.defect && items.some(item => !DEFECT_REASONS.has(item.reason))) throw fault(400, 'RETURN_VALIDATION', 'Defect reports must use a defect, damage, or wrong-product reason.');
  if (requestType === RETURN_TYPES.replacement && items.some(item => item.reason !== 'size_issue' || !item.replacementSize)) throw fault(400, 'RETURN_VALIDATION', 'Each size replacement needs a selected item, Size issue reason, and replacement size.');
  const canonical = JSON.stringify({ orderId, requestType, items: [...items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)), comments,
    ...(refundDestination ? { refundDestination } : {}) });
  return { orderId, idempotencyKey, requestType, refundDestination: body.refundDestination || null,
    replacementSize: items.length === 1 ? items[0].replacementSize : null, items, comments,
    requestHash: crypto.createHash('sha256').update(canonical).digest('hex') };
}
function returnNumber() { return `R-${crypto.randomUUID().replace(/-/g, '')}`; }

function formatReturn(row) {
  if (!row) return null;
  const outbound = row.outbound_order;
  return {
    id: row.id, orderId: row.order_id, orderNumber: row.order_number || null, returnNumber: row.return_number,
    status: row.status, reason: row.reason || null, comments: row.comments || null, requestType: row.request_type || RETURN_TYPES.return,
    requestedReplacementSize: row.requested_replacement_size || null, returnShippingDeduction: Number(row.return_shipping_deduction || 0),
    refundAmount: Number(row.refund_amount || 0), refundStatus: row.refund_status,
    shiprocketReturnOrderId: row.shiprocket_return_order_id || null, returnAwb: row.return_awb || null,
    shiprocketOutboundOrderId: row.shiprocket_outbound_order_id || null,
    outboundAwb: outbound?.awb || row.outbound_awb || null,
    outboundStatus: outbound?.status === 'delivered' ? 'delivered' : outbound?.shippingStatus || row.outbound_status || null,
    outboundTrackingUrl: outbound?.trackingUrl || row.outbound_tracking_url || null, outboundCreatedAt: row.outbound_created_at || null,
    outboundOrder: row.outbound_order || null, outboundStage: row.outbound_order ? outboundStage(row.outbound_order) : 0,
    adminCategory: adminCategory(row),
    replacementShipmentPending: row.pending_operation === 'replacement_create',
    pickupStatus: row.pickup_status || null,
    trackingSyncUnavailable: Boolean(row.tracking_sync_unavailable),
    pickupDelayed: row.status === 'shiprocket_failed' || (row.status === 'requested' && row.pending_operation === 'create'),
    cancellationPending: row.pending_operation === 'cancel',
    customer: row.customer_name == null ? undefined : { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    paymentMethod: row.payment_method || null, items: (row.items || []).map(item => ({ ...item,
      defectPhotos: row.defect_photo_evidence?.items?.find(entry => entry.orderItemId === item.orderItemId)?.photos?.map(photo => ({ id: photo.id, url: photo.url })) || [] })), requestedAt: row.requested_at,
    defectPhotoReviewPending: Boolean(row.defect_photo_evidence && !row.defect_photo_review && row.status === 'requested'),
    defectPhotoReview: row.defect_photo_review || null,
    refundDestination: codRefunds.summary({
      payment_method: row.payment_method, return_status: row.status, return_refund_status: row.refund_status,
      destination_id: row.refund_destination_id, method: row.refund_destination_method,
      masked_destination: row.refund_destination_masked, destination_status: row.refund_destination_status,
      transaction_reference: row.refund_transaction_reference,
      destination_completed_at: row.refund_destination_completed_at
    }),
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
       (SELECT a.metadata FROM return_request_audit a WHERE a.return_request_id=rr.id AND a.action='DEFECT_PHOTOS_ATTACHED' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS defect_photo_evidence,
       (SELECT a.metadata FROM return_request_audit a WHERE a.return_request_id=rr.id AND a.action='DEFECT_PHOTO_REVIEWED' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS defect_photo_review,
       (SELECT json_build_object('id', child.id, 'orderNumber', child.order_number, 'orderType', child.order_type,
         'sourceOrderId', child.source_order_id, 'returnId', child.return_request_id, 'status', child.order_status,
         'holdReason', child.fulfillment_hold_reason, 'shiprocketOrderId', s.shiprocket_order_id,
         'awb', s.awb_code, 'shippingStatus', s.shipping_status, 'trackingStatus', s.tracking_status,
         'trackingUrl', s.tracking_url, 'pickupStatus', s.pickup_status, 'pendingOperation', s.pending_operation,
         'lastErrorCode', s.last_error_code, 'shippedAt', child.shipped_at, 'deliveredAt', child.delivered_at)
        FROM orders child LEFT JOIN shipments s ON s.order_id = child.id WHERE child.return_request_id = rr.id) AS outbound_order,
       d.id AS refund_destination_id, d.method AS refund_destination_method,
       d.masked_destination AS refund_destination_masked, d.status AS refund_destination_status,
       d.transaction_reference AS refund_transaction_reference, d.completed_at AS refund_destination_completed_at,
       COALESCE(json_agg(json_build_object('id', ri.id, 'orderItemId', ri.order_item_id,
         'productName', oi.product_name, 'sku', oi.sku, 'size', oi.size, 'color', oi.color,
         'imageUrl', (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at LIMIT 1),
         'quantity', ri.quantity, 'reason', ri.reason, 'comments', ri.comments, 'replacementSize', ri.replacement_size,
         'inspectionStatus', ri.inspection_status, 'inspectionReason', ri.inspection_reason, 'inspectedAt', ri.inspected_at,
         'refundAmount', ri.refund_amount) ORDER BY ri.created_at) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
     FROM return_requests rr JOIN orders o ON o.id = rr.order_id JOIN users u ON u.id = rr.user_id
     LEFT JOIN cod_refund_destinations d ON d.return_id = rr.id
     LEFT JOIN return_items ri ON ri.return_request_id = rr.id LEFT JOIN order_items oi ON oi.id = ri.order_item_id
     WHERE rr.id = $1 ${owner} GROUP BY rr.id, o.order_number, o.payment_method, u.name, u.email, u.phone, d.id`, params
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
    const overrides = await client.query(`SELECT * FROM return_eligibility_overrides
      WHERE order_id = $1 AND user_id = $2 AND request_type = $3 AND used_at IS NULL FOR UPDATE`, [input.orderId, userId, input.requestType]);
    const eligibility = evaluateEligibility(source.order, source.items, now, overrides.rows.map(row => row.request_type));
    const requestType = eligibility.requestTypes?.find(type => type.code === input.requestType);
    if (!eligibility.eligible || !requestType?.eligible) {
      if (eligibility.reason === 'FULLY_RETURNED') {
        throw fault(409, 'FULLY_RETURNED', 'All purchased quantities already have a return request.');
      }
      const message = input.requestType === RETURN_TYPES.defect
        ? 'Defect reporting window ended. Contact support for late defect claims.'
        : input.requestType === RETURN_TYPES.replacement ? 'The 7-day size replacement window has closed.' : 'The 7-day return window has closed.';
      throw fault(409, input.requestType === RETURN_TYPES.defect ? 'DEFECT_WINDOW_CLOSED' : 'WINDOW_CLOSED', message);
    }
    // Keep the selected option as the request type. Defect-related reasons
    // still use their existing reporting window within the Return Item flow.
    if (input.requestType === RETURN_TYPES.return && input.items.some(item => DEFECT_REASONS.has(item.reason)) &&
        !eligibility.requestTypes.some(type => type.code === RETURN_TYPES.defect && type.eligible)) {
      throw fault(409, 'DEFECT_WINDOW_CLOSED', 'Defect reporting window ended. Contact support for late defect claims.');
    }
    const byId = new Map(refundableItems(source.order, source.items).map(item => [item.id, item]));
    const selected = input.items.map(item => {
      const purchased = byId.get(item.orderItemId);
      if (!purchased) throw fault(400, 'RETURN_ITEM_INVALID', 'A selected item does not belong to this order.');
      const alreadyReturned = Number(purchased.returned_quantity || 0);
      if (alreadyReturned >= purchased.quantity) throw fault(409, 'RETURN_ITEM_ALREADY_REQUESTED',
        'All units of this product already have a return or replacement request.', { orderItemId: item.orderItemId });
      if (item.quantity > purchased.quantity - alreadyReturned) throw fault(409, 'RETURN_QUANTITY_EXCEEDED', 'Return quantity exceeds the remaining purchased quantity.');
      return { ...item, productId: purchased.product_id, size: purchased.size, refundPaise: purchased.refundFor(alreadyReturned, item.quantity) };
    });
    if (input.requestType === RETURN_TYPES.replacement) {
      for (const original of selected) {
      if (String(original.size || '').trim().toLowerCase() === original.replacementSize.toLowerCase()) {
        throw fault(400, 'RETURN_VALIDATION', 'Choose a different replacement size for every selected item.');
      }
      const available = await client.query(`SELECT 1 FROM product_size_details psd JOIN sizes s ON s.id = psd.size_id
        WHERE psd.product_id = (SELECT product_id FROM order_items WHERE id = $1)
          AND psd.is_active = TRUE AND LOWER(s.name) = LOWER($2)`, [original.orderItemId, original.replacementSize]);
      if (!available.rows.length) throw fault(409, 'REPLACEMENT_SIZE_UNAVAILABLE', 'That replacement size is not available for this product.',
        { field: 'replacementSize', orderItemId: original.orderItemId });
      }
    }
    const totalPaise = selected.reduce((sum, item) => sum + item.refundPaise, 0);
    const shippingDeductionPaise = input.requestType === RETURN_TYPES.return
      ? Math.min(totalPaise, returnShippingDeductionPaise()) : 0;
    const eligibleRefundPaise = input.requestType === RETURN_TYPES.replacement ? 0 : totalPaise - shippingDeductionPaise;
    if (source.order.payment_method === 'cod' && input.requestType !== RETURN_TYPES.replacement && eligibleRefundPaise > 0 && !input.refundDestination) {
      throw fault(400, 'COD_REFUND_DESTINATION_REQUIRED', 'Enter bank or UPI details to receive your COD refund after inspection.');
    }
    const override = overrides.rows[0] || null;
    const inserted = await client.query(
      `INSERT INTO return_requests
       (order_id, user_id, return_number, reason, comments, status, refund_amount, refund_status, idempotency_key, request_hash, request_type, requested_replacement_size, return_shipping_deduction, eligibility_override_id)
       VALUES ($1,$2,$3,$4,$5,'requested',$6,'pending',$7,$8,$9,$10,$11,$12) RETURNING *`,
        [input.orderId, userId, returnNumber(), selected.length === 1 ? selected[0].reason : 'multiple_items', input.comments,
        rupees(eligibleRefundPaise), input.idempotencyKey, input.requestHash, input.requestType, selected.length === 1 ? selected[0].replacementSize : null, rupees(shippingDeductionPaise), override?.id || null]
    );
    for (const item of selected) {
      await client.query(
        `INSERT INTO return_items (return_request_id, order_item_id, quantity, reason, comments, replacement_size, refund_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [inserted.rows[0].id, item.orderItemId, item.quantity, item.reason, item.comments, item.replacementSize, rupees(item.refundPaise)]
      );
    }
    if (input.refundDestination && source.order.payment_method === 'cod' && input.requestType !== RETURN_TYPES.replacement) {
      await codRefunds.saveBeforeInspection(client, { id: inserted.rows[0].id, order_id: input.orderId,
        user_id: userId, payment_method: source.order.payment_method }, input.refundDestination);
    }
    if (input.requestType === RETURN_TYPES.defect) await require('./defectPhotoService').attach(client, userId, input.orderId, selected, inserted.rows[0].id);
    if (override) await client.query('UPDATE return_eligibility_overrides SET used_at = NOW() WHERE id = $1', [override.id]);
    await client.query(`INSERT INTO return_request_audit (return_request_id, order_id, actor_user_id, action, reason, metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [inserted.rows[0].id, input.orderId, userId, 'REQUEST_SUBMITTED', null,
      JSON.stringify({ requestType: input.requestType, returnShippingDeduction: rupees(shippingDeductionPaise), usedEligibilityOverride: Boolean(override) })]);
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
    `SELECT rr.id, rr.return_number, rr.refund_amount, rr.request_type, o.payment_method, oa.email AS pickup_email, oa.*,
       COALESCE(json_agg(json_build_object('sku', oi.sku, 'variantId', oi.variant_id, 'id', oi.id,
         'name', oi.product_name, 'size', oi.size, 'quantity', ri.quantity, 'unitPrice', oi.unit_price,
         'refundAmount', ri.refund_amount) ORDER BY ri.created_at), '[]') AS items
     FROM return_requests rr JOIN orders o ON o.id = rr.order_id
     JOIN order_addresses oa ON oa.order_id = o.id JOIN return_items ri ON ri.return_request_id = rr.id
     JOIN order_items oi ON oi.id = ri.order_item_id WHERE rr.id = $1
     GROUP BY rr.id, o.id, oa.id`, [returnId]
  );
  const row = result.rows[0];
  if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  // Use the immutable delivery contact, just as forward shipping does. Mobile
  // accounts need not link a Google/email identity to return an existing order.
  const pickupEmail = typeof row.pickup_email === 'string' ? row.pickup_email.trim().toLowerCase() : '';
  if (!pickupEmail || pickupEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pickupEmail)) {
    throw fault(409, 'RETURN_CUSTOMER_EMAIL_REQUIRED', 'The saved delivery email needs review before a return shipment can be created.');
  }
  const customer = splitName(cleanText(row.full_name, 'Customer name', 255, true));
  const warehouse = await resolveReturnWarehouse(api, env);
  const tax = productTaxPercent(env);
  const eligibleAmounts = row.items.map(item => moneyPaise(item.refundAmount));
  const eligibleTotal = eligibleAmounts.reduce((sum, amount) => sum + amount, 0);
  // The customer's saved refund already includes the return shipping deduction.
  // Size exchanges retain their merchandise value: they do not pay a cash refund.
  const refundTotal = row.request_type === RETURN_TYPES.replacement ? eligibleTotal : moneyPaise(row.refund_amount);
  if (refundTotal > eligibleTotal) throw fault(409, 'RETURN_FINANCIAL_REVIEW', 'The saved return totals need review.');
  // Allocate the net amount over lines in integer paise, retaining rounding cents.
  const shares = eligibleAmounts.map((amount, index) => {
    const numerator = BigInt(refundTotal) * BigInt(amount);
    return { index, amount: eligibleTotal ? Number(numerator / BigInt(eligibleTotal)) : 0,
      remainder: eligibleTotal ? numerator % BigInt(eligibleTotal) : 0n };
  });
  const remainder = refundTotal - shares.reduce((sum, share) => sum + share.amount, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remainder; index++) ranked[index].amount++;
  const items = row.items.map((item, index) => {
    const gross = moneyPaise(item.unitPrice) * Number(item.quantity);
    const net = shares[index].amount;
    if (net > gross) throw fault(409, 'RETURN_FINANCIAL_REVIEW', 'The saved return item amounts need review.');
    return { sku: cleanText(item.sku || item.variantId || item.id, 'Item SKU', 100, true),
      name: productNameWithSize(item.name, item.size), units: Number(item.quantity),
      selling_price: Number(item.unitPrice), tax, discount: Number(rupees(gross - net)), qc_enable: false, qc_size: item.size || '' };
  });
  const { weight, length, breadth, height } = packageDetails({}, env, items);
  return {
    order_id: row.return_number, order_date: indiaOrderDate(),
    pickup_customer_name: customer.first, pickup_last_name: customer.last,
    pickup_address: cleanText(row.address_line1, 'Pickup address', 255, true),
    pickup_address_2: [row.address_line2, row.landmark].filter(Boolean).join(', ').slice(0, 255),
    pickup_city: cleanText(row.city, 'Pickup city', 100, true), pickup_state: cleanText(row.state, 'Pickup state', 100, true),
    pickup_country: 'India', pickup_pincode: normalizePincode(row.postal_code, 'RETURN_ADDRESS_REVIEW', 'The saved delivery pincode needs review.'), pickup_email: pickupEmail,
    pickup_phone: normalizePhone(row.phone), pickup_isd_code: '91',
    shipping_customer_name: warehouse.first, shipping_last_name: warehouse.last,
    shipping_address: warehouse.address, shipping_address_2: warehouse.address2,
    shipping_city: warehouse.city, shipping_state: warehouse.state, shipping_country: 'India',
    shipping_pincode: warehouse.pincode, shipping_email: warehouse.email,
    shipping_phone: warehouse.phone, shipping_isd_code: '91',
    order_items: items, payment_method: 'PREPAID',
    total_discount: Number(rupees(items.reduce((sum, item) => sum + moneyPaise(item.discount), 0))),
    // Return creation subtracts total_discount from sub_total. Send the gross
    // merchandise subtotal so purchase/shipping deductions are applied once.
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
       AND pending_operation IS NULL AND status IN ('requested','shiprocket_failed')
       AND (NOT EXISTS (SELECT 1 FROM return_request_audit a WHERE a.return_request_id=return_requests.id AND a.action='DEFECT_PHOTOS_ATTACHED')
         OR EXISTS (SELECT 1 FROM return_request_audit a WHERE a.return_request_id=return_requests.id AND a.action='DEFECT_PHOTO_REVIEWED')) RETURNING id`, [returnId]
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
  if (local.created && input.requestType !== RETURN_TYPES.defect) await provisionReturn(local.row.id, { database, api: dependencies.api || shiprocket,
    env: dependencies.env || process.env, notifications: notifier });
  await notifySafely(() => notifier.returnRequested(local.row.id));
  return formatReturn(await findReturn(database, local.row.id, userId));
}

async function refreshReturnPage(entries, database, userId, admin, dependencies) {
  const tracking = dependencies.tracking || (database === pool ? require('./returnTrackingService') :
    require('./returnTrackingService').createReturnTrackingService({ database, ...dependencies }));
  const requests = new Array(entries.length);
  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const position = index++;
      let row = await findReturn(database, entries[position].id, userId, admin);
      if (!row) continue;
      const sync = await tracking.refresh(row, { id: admin ? row.user_id : userId, role: admin ? 'admin' : 'customer' });
      if (sync.checked) row = await findReturn(database, entries[position].id, userId, admin);
      if (row) requests[position] = formatReturn({ ...row, tracking_sync_unavailable: sync.unavailable });
    }
  }
  // Limit provider concurrency while preserving the page's requested order.
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
  return requests.filter(Boolean);
}

async function listCustomerReturns(userId, database = pool, { limit = 100, offset = 0, statuses = null, orderId = null } = {}, dependencies = {}) {
  if (orderId !== null) orderId = validId(orderId, 'order ID');
  const result = await database.query(
    `SELECT id FROM return_requests WHERE user_id = $1 AND ($4::text[] IS NULL OR status = ANY($4))
      AND ($5::uuid IS NULL OR order_id = $5) ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset, statuses, orderId]
  );
  return refreshReturnPage(result.rows, database, userId, false, dependencies);
}
async function listAdminReturns(database = pool, { limit = 100, offset = 0, tab = 'all', ...filters } = {}, dependencies = {}) {
  if (!['all', 'requested', 'inspection_required', 'completed'].includes(tab)) throw fault(400, 'RETURN_VALIDATION', 'Choose a valid returns tab.');
  const filtered = require('./adminListFilters')(filters, { returns: true, values: [limit, offset, tab] });
  const result = await database.query(`SELECT rr.id FROM return_requests rr JOIN orders original ON original.id = rr.order_id
    LEFT JOIN orders child ON child.return_request_id = rr.id LEFT JOIN shipments s ON s.order_id = child.id
    LEFT JOIN cod_refund_destinations d ON d.return_id = rr.id
    WHERE ($3 = 'all' OR (${ADMIN_CATEGORY_SQL}) = $3) ${filtered.clause} ORDER BY ${filtered.order} LIMIT $1 OFFSET $2`, filtered.values);
  return refreshReturnPage(result.rows, database, null, true, dependencies);
}

async function grantEligibilityOverride(adminUserId, body = {}, database = pool) {
  const orderId = validId(body.orderId, 'order ID');
  const userId = validId(body.userId, 'customer ID');
  const requestType = body.requestType;
  if (!Object.values(RETURN_TYPES).includes(requestType)) throw fault(400, 'RETURN_VALIDATION', 'Select a valid request type.');
  const reason = cleanText(body.reason, 'Override reason', 500, true);
  if (reason.length < 5) throw fault(400, 'RETURN_VALIDATION', 'Provide a meaningful override reason.');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query('SELECT id FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, userId]);
    if (!order.rows.length) throw fault(404, 'ORDER_NOT_FOUND', 'The customer order was not found.');
    const result = await client.query(`INSERT INTO return_eligibility_overrides
      (order_id, user_id, request_type, reason, granted_by)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id, user_id, request_type) WHERE used_at IS NULL
      DO UPDATE SET reason = EXCLUDED.reason, granted_by = EXCLUDED.granted_by, granted_at = NOW()
      RETURNING *`, [orderId, userId, requestType, reason, adminUserId]);
    await client.query(`INSERT INTO return_request_audit (order_id, actor_user_id, action, reason, metadata)
      VALUES ($1,$2,'ELIGIBILITY_OVERRIDE_GRANTED',$3,$4::jsonb)`, [orderId, adminUserId, reason,
      JSON.stringify({ userId, requestType, statutoryRemedyReviewRequired: requestType === RETURN_TYPES.defect })]);
    await client.query('COMMIT');
    return { id: result.rows[0].id, orderId, userId, requestType, reason, grantedAt: result.rows[0].granted_at };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function listEligibilityOverrideHistory(orderId, database = pool) {
  orderId = validId(orderId, 'order ID');
  const [overrides, audit] = await Promise.all([
    database.query(`SELECT eo.id, eo.order_id, eo.user_id, eo.request_type, eo.reason, eo.granted_at, eo.used_at,
        u.name AS granted_by_name
      FROM return_eligibility_overrides eo LEFT JOIN users u ON u.id = eo.granted_by
      WHERE eo.order_id = $1 ORDER BY eo.granted_at DESC`, [orderId]),
    database.query(`SELECT action, reason, metadata, created_at FROM return_request_audit
      WHERE order_id = $1 AND action IN ('ELIGIBILITY_OVERRIDE_GRANTED', 'REQUEST_SUBMITTED')
      ORDER BY created_at DESC`, [orderId])
  ]);
  return {
    overrides: overrides.rows.map(row => ({ id: row.id, orderId: row.order_id, userId: row.user_id,
      requestType: row.request_type, reason: row.reason, grantedAt: row.granted_at, usedAt: row.used_at || null,
      grantedBy: row.granted_by_name || 'Administrator' })),
    audit: audit.rows.map(row => ({ action: row.action, reason: row.reason || null, metadata: row.metadata || {}, createdAt: row.created_at }))
  };
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
      if (Object.values(RETURN_TYPES).includes(row.request_type)) throw fault(409, 'RETURN_ITEM_INSPECTION_REQUIRED', 'Inspect each product and submit its decision before refunding or returning it to the customer.');
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
    if (Object.values(RETURN_TYPES).includes(row.request_type)) throw fault(409, 'RETURN_ITEM_INSPECTION_REQUIRED', 'Submit the inspection decision for each product.');
    if (!row.inventory_restored_at) {
      const items = await client.query(
        `SELECT psd.id AS inventory_id, psd.product_id, psd.size_id,
           SUM(ri.quantity)::integer AS quantity FROM return_items ri
         JOIN order_items oi ON oi.id = ri.order_item_id
         JOIN product_variants pv ON pv.id = oi.variant_id
         JOIN product_size_details psd ON psd.product_id = oi.product_id AND psd.size_id = pv.size_id
         WHERE ri.return_request_id = $1
         GROUP BY psd.id, psd.product_id, psd.size_id ORDER BY psd.id`, [returnId]
      );
      if (!items.rows.length || items.rows.some(item => !item.inventory_id)) throw fault(409, 'RETURN_INVENTORY_REVIEW', 'Returned inventory needs manual review.');
      for (const item of items.rows) {
        const restored = await client.query(`UPDATE product_size_details
          SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2
          RETURNING stock_quantity - $1 AS quantity_before, stock_quantity AS quantity_after`, [item.quantity, item.inventory_id]);
        if (!restored.rows.length) throw fault(409, 'RETURN_INVENTORY_REVIEW', 'Returned inventory needs manual review.');
        await inventory.recordMovement(client, { inventoryId: item.inventory_id, productId: item.product_id,
          sizeId: item.size_id, movementType: 'RETURN_RESTOCKED', quantityChange: item.quantity,
          quantityBefore: restored.rows[0].quantity_before, quantityAfter: restored.rows[0].quantity_after,
          returnId, reason: 'Return received and approved for resale',
          idempotencyKey: `RETURN_RESTOCKED:${returnId}:${item.inventory_id}` });
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

// A received replacement can contain several products.  Warehouse staff decide
// each line independently; the customer still receives one consolidated parcel.
async function inspectReturnItem(returnId, itemId, input, actorUserId, database = pool) {
  returnId = validId(returnId, 'return ID');
  itemId = validId(itemId, 'return item ID');
  const decision = input?.decision;
  if (!['approved', 'rejected'].includes(decision)) throw fault(400, 'RETURN_VALIDATION', 'Choose approve or reject for this product.');
  const reason = cleanText(input?.reason, 'Inspection reason', 500, decision === 'rejected');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const request = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
    if (!request.rows[0]) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (request.rows[0].request_type !== RETURN_TYPES.replacement) throw fault(409, 'RETURN_ITEM_INSPECTION_UNAVAILABLE', 'Per-product replacement inspection is available for size exchanges only.');
    if (request.rows[0].status !== 'received') throw fault(409, 'RETURN_TRANSITION_INVALID', 'Products can be inspected only after the return is received.');
    if (request.rows[0].pending_operation) throw fault(409, 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED', 'A shipment operation is already pending.');
    const updated = await client.query(`UPDATE return_items SET inspection_status = $1, inspection_reason = $2,
       inspected_at = NOW(), inspected_by = $3 WHERE id = $4 AND return_request_id = $5 AND inspection_status = 'pending'
       RETURNING id`, [decision, reason, actorUserId || null, itemId, returnId]);
    if (!updated.rows.length) throw fault(409, 'RETURN_ITEM_ALREADY_INSPECTED', 'This product has already been inspected.');
    await client.query(`INSERT INTO return_request_audit (return_request_id, order_id, actor_user_id, action, reason, metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [returnId, request.rows[0].order_id, actorUserId || null,
      decision === 'approved' ? 'ITEM_REPLACEMENT_APPROVED' : 'ITEM_REPLACEMENT_REJECTED', reason,
      JSON.stringify({ returnItemId: itemId })]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  return formatReturn(await findReturn(database, returnId, null, true));
}

async function replacementOutboundPayload(database, returnId, env = process.env, api = shiprocket) {
  const result = await database.query(`SELECT rr.return_number, rr.request_type, rr.order_id, u.email AS customer_email, oa.*, ri.id AS return_item_id,
      ri.quantity, ri.inspection_status, ri.replacement_size, oi.product_id, oi.product_name, oi.sku, oi.variant_id, oi.size, oi.unit_price,
      (SELECT id FROM orders WHERE return_request_id = rr.id) AS outbound_order_id,
      (SELECT pv.sku FROM product_variants pv JOIN sizes s ON s.id = pv.size_id
        WHERE pv.product_id = oi.product_id AND LOWER(s.name) = LOWER(ri.replacement_size)
        AND pv.color_id IS NOT DISTINCT FROM (SELECT color_id FROM product_variants WHERE id = oi.variant_id)
        ORDER BY pv.id LIMIT 1) AS replacement_sku
    FROM return_requests rr JOIN orders o ON o.id = rr.order_id JOIN users u ON u.id = rr.user_id
    JOIN order_addresses oa ON oa.order_id = o.id JOIN return_items ri ON ri.return_request_id = rr.id
    JOIN order_items oi ON oi.id = ri.order_item_id WHERE rr.id = $1
      AND (rr.request_type='replacement' OR ri.inspection_status='rejected') ORDER BY ri.created_at`, [returnId]);
  const rows = result.rows;
  if (!rows.length) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  if (rows.some(row => !['approved', 'rejected'].includes(row.inspection_status))) throw fault(409, 'RETURN_INSPECTION_PENDING', 'Inspect every returned product before creating the replacement shipment.');
  const customer = splitName(cleanText(rows[0].full_name, 'Customer name', 255, true));
  if (!rows[0].customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rows[0].customer_email)) throw fault(409, 'RETURN_CUSTOMER_EMAIL_REQUIRED', 'Add and verify an email address before shipping.');
  await resolveReturnWarehouse(api, env);
  const items = rows.map(row => ({
    sku: cleanText(row.inspection_status === 'approved'
      ? (row.replacement_sku || `${row.product_id}-${row.replacement_size}`)
      : (row.sku || row.variant_id || row.return_item_id), 'Item SKU', 100, true),
    name: productNameWithSize(row.product_name,
      row.inspection_status === 'approved' ? row.replacement_size : row.size,
      row.inspection_status === 'approved' ? 'Replacement' : 'Returned item'),
    units: Number(row.quantity), selling_price: Number(row.unit_price),
    requestedSize: row.inspection_status === 'approved' ? row.replacement_size : row.size,
    inspectionStatus: row.inspection_status, productId: row.product_id, returnItemId: row.return_item_id
  }));
  const { weight, length, breadth, height } = packageDetails({}, env, items);
  const tax = productTaxPercent(env);
  return { rows, items, payload: {
    order_id: rows[0].outbound_order_id || `${rows[0].return_number}-OUT`, order_date: indiaOrderDate(), pickup_location: requiredEnv(env, 'SHIPROCKET_PICKUP_LOCATION'),
    billing_customer_name: customer.first, billing_last_name: customer.last,
    billing_address: cleanText(rows[0].address_line1, 'Delivery address', 255, true),
    billing_address_2: [rows[0].address_line2, rows[0].landmark].filter(Boolean).join(', ').slice(0, 255),
    billing_city: cleanText(rows[0].city, 'Delivery city', 100, true), billing_state: cleanText(rows[0].state, 'Delivery state', 100, true),
    billing_pincode: normalizePincode(rows[0].postal_code, 'RETURN_ADDRESS_REVIEW', 'The saved delivery pincode needs review.'), billing_country: 'India',
    billing_email: rows[0].customer_email, billing_phone: normalizePhone(rows[0].phone), shipping_is_billing: true,
    order_items: items.map(({ sku, name, units, selling_price }) => ({ sku, name, units, selling_price, tax })), payment_method: 'Prepaid',
    sub_total: Number(rupees(items.reduce((sum, item) => sum + moneyPaise(item.selling_price) * item.units, 0))), total_discount: 0,
    shipping_charges: 0, length, breadth, height, weight
  }};
}

function inspectionDecisions(input) {
  if (!Array.isArray(input?.items) || input.items.length > 50) throw fault(400, 'RETURN_VALIDATION', 'Submit inspection decisions for every product.');
  const seen = new Set();
  return input.items.map(item => {
    const itemId = validId(item?.itemId, 'return item ID').toLowerCase();
    if (seen.has(itemId)) throw fault(400, 'RETURN_VALIDATION', 'Each product can have only one inspection decision.');
    seen.add(itemId);
    if (!['approved', 'rejected'].includes(item?.decision)) throw fault(400, 'RETURN_VALIDATION', 'Choose approve or reject for every product.');
    return { itemId, decision: item.decision, reason: cleanText(item.reason, 'Inspection reason', 500, true) };
  });
}

async function submitReplacementInspection(returnId, input, actorUserId, dependencies = {}) {
  returnId = validId(returnId, 'return ID');
  const database = dependencies.database || pool;
  const row = (await database.query('SELECT * FROM return_requests WHERE id = $1', [returnId])).rows[0];
  if (row && row.request_type !== RETURN_TYPES.replacement) {
    return require('./returnInspectionService').submit(returnId, input, actorUserId, dependencies);
  }
  const decisions = inspectionDecisions(input);
  return createReplacementShipment(returnId, actorUserId, { ...dependencies, decisions });
}

async function createReplacementShipment(returnId, actorUserId, { database = pool, api = shiprocket, env = process.env, decisions = null, rejectedOnly = false } = {}) {
  returnId = validId(returnId, 'return ID');
  const client = await database.connect();
  let request;
  const reservations = [];
  const attemptId = crypto.randomUUID();
  let remote;
  let remoteCreated = false;
  let providerStarted = false;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
    request = found.rows[0];
    if (!request) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (request.request_type !== RETURN_TYPES.replacement && !rejectedOnly) throw fault(409, 'RETURN_TRANSITION_INVALID', 'Only inspected outbound items can be shipped.');
    if (request.pending_operation) throw fault(409, 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED', 'A replacement shipment operation is already pending reconciliation.');
    if (request.shiprocket_outbound_shipment_id) { await client.query('COMMIT'); return formatReturn(await findReturn(database, returnId, null, true)); }
    if (request.status !== 'received') throw fault(409, 'RETURN_TRANSITION_INVALID', 'Inspection can be submitted only after the return reaches the warehouse.');
    const products = await client.query('SELECT id, inspection_status, inspection_reason FROM return_items WHERE return_request_id = $1 ORDER BY id FOR UPDATE', [returnId]);
    if (!products.rows.length) throw fault(409, 'RETURN_INSPECTION_PENDING', 'This request has no products to inspect.');
    if (decisions) {
      if (decisions.some(item => !products.rows.some(row => row.id === item.itemId))) throw fault(400, 'RETURN_VALIDATION', 'A product does not belong to this return request.');
      for (const item of products.rows) {
        const decision = decisions.find(entry => entry.itemId === item.id);
        if (item.inspection_status !== 'pending') {
          if (decision && (decision.decision !== item.inspection_status || decision.reason !== item.inspection_reason)) throw fault(409, 'RETURN_ITEM_ALREADY_INSPECTED', 'A saved inspection decision cannot be changed.');
          continue;
        }
        if (!decision) throw fault(400, 'RETURN_INSPECTION_PENDING', 'Choose approve or reject and enter a reason for every product.');
        await client.query(`UPDATE return_items SET inspection_status = $1, inspection_reason = $2, inspected_at = NOW(), inspected_by = $3
          WHERE id = $4 AND return_request_id = $5`, [decision.decision, decision.reason, actorUserId || null, item.id, returnId]);
        await client.query(`INSERT INTO return_request_audit (return_request_id, order_id, actor_user_id, action, reason, metadata)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [returnId, request.order_id, actorUserId || null,
          decision.decision === 'approved' ? 'ITEM_REPLACEMENT_APPROVED' : 'ITEM_REPLACEMENT_REJECTED', decision.reason, JSON.stringify({ returnItemId: item.id })]);
      }
    } else if (products.rows.some(item => item.inspection_status === 'pending')) {
      throw fault(409, 'RETURN_INSPECTION_PENDING', 'Inspect every returned product before creating the replacement shipment.');
    }
    // Reserve the replacement sizes atomically before contacting the provider.
    // Rejected originals never add or subtract sellable stock.
    const stock = rejectedOnly ? { rows: [] } : await client.query(`SELECT psd.id, psd.product_id, psd.size_id, SUM(ri.quantity)::integer AS quantity
      FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
      JOIN sizes s ON LOWER(s.name) = LOWER(ri.replacement_size)
      JOIN product_size_details psd ON psd.product_id = oi.product_id AND psd.size_id = s.id
      WHERE ri.return_request_id = $1 AND ri.inspection_status = 'approved'
      GROUP BY psd.id, psd.product_id, psd.size_id ORDER BY psd.id`, [returnId]);
    const approved = rejectedOnly ? { rows: [] } : await client.query(`SELECT ri.id FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN product_size_details original ON original.product_id = oi.product_id AND original.size_id = pv.size_id
      LEFT JOIN sizes s ON LOWER(s.name) = LOWER(ri.replacement_size)
      LEFT JOIN product_size_details replacement ON replacement.product_id = oi.product_id AND replacement.size_id = s.id
      WHERE ri.return_request_id = $1 AND ri.inspection_status = 'approved' AND (original.id IS NULL OR replacement.id IS NULL)`, [returnId]);
    if (approved.rows.length) throw fault(409, 'REPLACEMENT_STOCK_UNAVAILABLE', 'Returned or replacement inventory needs review.');
    for (const item of stock.rows) {
      const reserved = await client.query(`UPDATE product_size_details SET stock_quantity = stock_quantity - $1, updated_at = NOW()
        WHERE id = $2 AND is_active = TRUE AND inventory_configured = TRUE AND stock_quantity >= $1
        RETURNING stock_quantity + $1 AS quantity_before, stock_quantity AS quantity_after`, [item.quantity, item.id]);
      if (!reserved.rows.length) throw fault(409, 'REPLACEMENT_STOCK_UNAVAILABLE', 'A replacement size is out of stock. No shipment was created.');
      reservations.push(item);
      await inventory.recordMovement(client, { inventoryId: item.id, productId: item.product_id, sizeId: item.size_id,
        movementType: 'ORDER_RESERVED', quantityChange: -item.quantity, quantityBefore: reserved.rows[0].quantity_before,
        quantityAfter: reserved.rows[0].quantity_after, returnId, createdBy: actorUserId || null,
        reason: 'Reserved for inspected size replacement', idempotencyKey: `REPLACEMENT_RESERVED:${attemptId}:${item.id}` });
    }
    const afterSales = await afterSalesOrders.ensureOrder(client, returnId, actorUserId);
    await client.query("UPDATE return_requests SET pending_operation = 'replacement_create', operation_started_at = NOW(), updated_at = NOW() WHERE id = $1", [returnId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }

  try {
    const outbound = await replacementOutboundPayload(database, returnId, env, api);
    providerStarted = true;
    remote = providerIdentifiers(await api.request('/orders/create/adhoc', { method: 'POST', body: outbound.payload }));
    remoteCreated = true;
    const finalize = await database.connect();
    try {
      await finalize.query('BEGIN');
      await finalize.query('SELECT id FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
      // Only approved products are restocked and exchanged; rejected products are
      // simply sent back to the customer in this same outbound parcel.
      for (const item of outbound.items.filter(item => item.inspectionStatus === 'approved')) {
        const original = await finalize.query(`UPDATE product_size_details psd SET stock_quantity = stock_quantity + $1, updated_at = NOW()
          WHERE psd.product_id = $2 AND psd.size_id = (SELECT size_id FROM product_variants WHERE id = (SELECT variant_id FROM order_items WHERE id = (SELECT order_item_id FROM return_items WHERE id = $3)))
          RETURNING id, product_id, size_id, stock_quantity - $1 AS quantity_before, stock_quantity AS quantity_after`, [item.units, item.productId, item.returnItemId]);
        if (!original.rows.length) throw fault(409, 'REPLACEMENT_STOCK_UNAVAILABLE', 'Returned inventory needs review.');
        const restored = original.rows[0];
        await inventory.recordMovement(finalize, { inventoryId: restored.id, productId: restored.product_id, sizeId: restored.size_id,
          movementType: 'RETURN_RESTOCKED', quantityChange: item.units, quantityBefore: restored.quantity_before,
          quantityAfter: restored.quantity_after, returnId, createdBy: actorUserId || null, reason: 'Replacement inspection approved',
          idempotencyKey: `REPLACEMENT_RESTOCKED:${returnId}:${item.returnItemId}` });
      }
      await afterSalesOrders.saveShipment(finalize, returnId, remote, outbound.payload);
      await finalize.query(`UPDATE return_requests SET shiprocket_outbound_order_id = $1, shiprocket_outbound_shipment_id = $2,
        outbound_awb = $3, outbound_status = 'created', outbound_created_at = NOW(), pending_operation = NULL, operation_started_at = NULL,
        status = 'approved', approved_at = COALESCE(approved_at, NOW()), refund_status = $5, last_error_code = NULL,
        updated_at = NOW() WHERE id = $4`, [remote.orderId, remote.shipmentId, remote.awb, returnId,
        rejectedOnly ? request.refund_status : 'not_applicable']);
      await finalize.query(`INSERT INTO return_request_audit (return_request_id, order_id, actor_user_id, action, metadata)
        VALUES ($1,$2,$3,'REPLACEMENT_OUTBOUND_CREATED',$4::jsonb)`, [returnId, request.order_id, actorUserId || null,
        JSON.stringify({ shiprocketOrderId: remote.orderId, shiprocketShipmentId: remote.shipmentId })]);
      await finalize.query('COMMIT');
    } catch (error) { await finalize.query('ROLLBACK').catch(() => {}); throw error; } finally { finalize.release(); }
  } catch (error) {
    const uncertain = remoteCreated || (providerStarted && (error.uncertain !== false));
    if (uncertain) {
      await database.query(`UPDATE return_requests SET last_error_code = 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED',
        shiprocket_outbound_order_id = COALESCE(shiprocket_outbound_order_id, $2),
        shiprocket_outbound_shipment_id = COALESCE(shiprocket_outbound_shipment_id, $3), updated_at = NOW()
        WHERE id = $1 AND pending_operation = 'replacement_create'`, [returnId, remote?.orderId || null, remote?.shipmentId || null]).catch(() => {});
      throw fault(409, 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED', 'Inspection decisions are saved. Check Shiprocket before retrying; the outbound shipment may already exist.');
    }
    const release = await database.connect();
    try {
      await release.query('BEGIN');
      await release.query('SELECT id FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
      for (const item of reservations) {
        const restored = await release.query(`UPDATE product_size_details SET stock_quantity = stock_quantity + $1, updated_at = NOW()
          WHERE id = $2 RETURNING stock_quantity - $1 AS quantity_before, stock_quantity AS quantity_after`, [item.quantity, item.id]);
        if (!restored.rows.length) throw fault(409, 'REPLACEMENT_STOCK_UNAVAILABLE', 'Reserved stock needs review.');
        await inventory.recordMovement(release, { inventoryId: item.id, productId: item.product_id, sizeId: item.size_id,
          movementType: 'ORDER_CANCELLED', quantityChange: item.quantity, quantityBefore: restored.rows[0].quantity_before,
          quantityAfter: restored.rows[0].quantity_after, returnId, createdBy: actorUserId || null,
          reason: 'Replacement shipment creation failed; reservation released', idempotencyKey: `REPLACEMENT_RELEASED:${attemptId}:${item.id}` });
      }
      await release.query(`UPDATE return_requests SET pending_operation = NULL, operation_started_at = NULL, last_error_code = $2,
        updated_at = NOW() WHERE id = $1 AND pending_operation = 'replacement_create'`, [returnId, error.code || 'REPLACEMENT_SHIPMENT_FAILED']);
      await release.query('COMMIT');
    } catch (releaseError) { await release.query('ROLLBACK').catch(() => {}); throw releaseError; }
    finally { release.release(); }
    throw error;
  }
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
    if (row.status === 'refunded' || row.refund_status === 'refunded') { await client.query('COMMIT'); return formatReturn(await findReturn(database, returnId, null, true)); }
    if (row.status !== 'approved' || !['pending', 'manual_required'].includes(row.refund_status) || row.pending_operation) throw fault(409, 'RETURN_TRANSITION_INVALID', 'This return is not ready for a refund.');
    if (moneyPaise(row.refund_amount) === 0) throw fault(409, 'RETURN_NO_REFUND', 'No refund is payable after inspection and shipping deduction.');
    if (row.payment_method === 'cod') {
      await client.query("UPDATE return_requests SET refund_status = 'manual_required', updated_at = NOW() WHERE id = $1", [returnId]);
      await client.query('COMMIT');
      await notifySafely(() => notifier.codRefundRequired(returnId));
      return formatReturn(await findReturn(database, returnId, null, true));
    }
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
  if (!awb && !Number.isSafeInteger(providerOrderId) && !channelOrderId) return { ignored: true, duplicate: false };
  const eventId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query('INSERT INTO return_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
    if (!claim.rows.length) { await client.query('COMMIT'); return { ignored: false, duplicate: true }; }
    const found = await client.query(
      `SELECT * FROM return_requests WHERE ($1::text IS NOT NULL AND (return_awb = $1 OR outbound_awb = $1))
       OR ($2::bigint IS NOT NULL AND (shiprocket_return_order_id = $2 OR shiprocket_outbound_order_id = $2))
       OR ($3::text IS NOT NULL AND ($3 = return_number OR $3 = return_number || '-OUT'
         OR id = (SELECT return_request_id FROM orders WHERE id::text = $3 AND order_type <> 'normal'))) FOR UPDATE`,
      [awb, Number.isSafeInteger(providerOrderId) ? providerOrderId : null, channelOrderId]
    );
    const row = found.rows[0];
    if (!row) { await client.query('COMMIT'); return { ignored: true, duplicate: false }; }
    const isOutboundEvent = (awb && row.outbound_awb === awb) ||
      (Number.isSafeInteger(providerOrderId) && Number(row.shiprocket_outbound_order_id) === providerOrderId) ||
      (channelOrderId && (channelOrderId === `${row.return_number}-OUT` || (channelOrderId !== row.return_number && UUID.test(channelOrderId))));
    if (isOutboundEvent) {
      const providerLabel = webhookStatusLabel(payload);
      if (!providerLabel && !next) { await client.query('COMMIT'); return { ignored: true, duplicate: false }; }
      await client.query(`UPDATE return_requests SET outbound_status = $1, outbound_awb = COALESCE(outbound_awb, $2),
        updated_at = NOW() WHERE id = $3`, [providerLabel, awb, row.id]);
      await client.query('UPDATE return_webhook_events SET return_request_id = $1 WHERE event_id = $2', [row.id, eventId]);
      await client.query('COMMIT');
      return { ignored: false, duplicate: false };
    }
    if (!next) { await client.query('COMMIT'); return { ignored: true, duplicate: false }; }
    const terminal = ['approved','refund_initiated','rejected','cancelled','refunded'].includes(row.status) || Boolean(row.inventory_restored_at);
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
  RETURN_REASONS, RETURN_TYPES, DEFECT_WINDOW_MS, RETURN_WINDOW_MS, ACTIVE_STATUSES, evaluateEligibility, refundableItems, returnShippingDeductionPaise,
  validateRequest, createLocalReturn, getEligibility, createReturn, provisionReturn, listCustomerReturns, listAdminReturns,
  findReturn, formatReturn, approveReturn, rejectReturn, initiateRefund, grantEligibilityOverride, listEligibilityOverrideHistory,
  inspectionDecisions, inspectReturnItem, submitReplacementInspection, createReplacementShipment, mappedWebhookStatus, processShiprocketWebhook, returnPayload, resolveReturnWarehouse
};
