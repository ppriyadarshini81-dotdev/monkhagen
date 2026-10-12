const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFECT_WINDOW_MS, RETURN_TYPES, RETURN_WINDOW_MS, evaluateEligibility, refundableItems, validateRequest,
  createLocalReturn, returnPayload, provisionReturn, mappedWebhookStatus,
  approveReturn, rejectReturn, initiateRefund, processShiprocketWebhook, resolveReturnWarehouse, getEligibility, listCustomerReturns
} = require('../services/returnService');
const { shippingError } = require('../config/shiprocket');
const { environment: packingEnvironment } = require('./helpers/shippingPackageFixtures');

const ORDER = '10000000-0000-4000-8000-000000000001';
const ITEM = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const IDEM = '30000000-0000-4000-8000-000000000001';
const RETURN = '40000000-0000-4000-8000-000000000001';
const INVENTORY = '50000000-0000-4000-8000-000000000001';
const PRODUCT = '60000000-0000-4000-8000-000000000001';
const SIZE = '70000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-10-17T09:30:00.000Z');
const order = (age, changes = {}) => ({ id: ORDER, order_status: 'delivered', delivered_at: new Date(NOW - age), subtotal: '200.00', discount_amount: '20.00', ...changes });
const items = (returned = 0) => [{ id: ITEM, product_name: 'Original tee', sku: 'TEE-M-BLUE', size: 'M', color: 'Blue', quantity: 2, unit_price: '100.00', returned_quantity: returned }];

test('exact seven-day delivery eligibility uses delivered_at and permits unrequested products', () => {
  for (const age of [0, 6 * 86400000, RETURN_WINDOW_MS]) {
    const result = evaluateEligibility(order(age), items(0), NOW);
    assert.equal(result.eligible, true);
    assert.equal(result.items[0].remainingQuantity, 2);
  }
  assert.equal(evaluateEligibility(order(RETURN_WINDOW_MS + 1), items(), NOW).reason, 'WINDOW_CLOSED');
});

test('existing requests are flagged even for partial quantities, and cancelled requests release the flag within the window', () => {
  const partial = evaluateEligibility(order(0), items(1), NOW);
  assert.equal(partial.hasExistingRequest, true);
  assert.equal(partial.eligible, true);
  assert.equal(partial.items[0].alreadyRequested, false);
  assert.equal(partial.items[0].remainingQuantity, 1);
  const otherProduct = evaluateEligibility(order(0), [...items(1), { ...items()[0], id: OTHER }], NOW);
  assert.equal(otherProduct.eligible, true);
  assert.deepEqual(otherProduct.items.map(item => item.alreadyRequested), [false, false]);
  const full = evaluateEligibility(order(0), items(2), NOW);
  assert.equal(full.hasExistingRequest, true);
  assert.equal(full.eligible, false);
  const cancelled = evaluateEligibility(order(0), items(0), NOW);
  assert.equal(cancelled.hasExistingRequest, false);
  assert.equal(cancelled.eligible, true);
  assert.equal(evaluateEligibility(order(RETURN_WINDOW_MS + 1), items(0), NOW).eligible, false);
});

test('cancelled history keeps the order link available without reserving products', async () => {
  const database = { async query(sql) {
    if (sql.startsWith('SELECT o.*')) return { rows: [{ ...order(0), has_return_history: true, has_existing_return_request: false }] };
    if (sql.startsWith('SELECT oi.*')) return { rows: items(0) };
    return { rows: [] };
  } };
  const result = await getEligibility('customer', ORDER, database, () => NOW);
  assert.equal(result.hasReturnHistory, true); assert.equal(result.hasExistingRequest, false);
  assert.equal(result.eligible, true); assert.equal(result.items[0].remainingQuantity, 2);
});

test('customer returns validate order filters and preserve authenticated user, status and pagination parameters', async () => {
  const calls = [];
  const database = { query: async (sql, params) => { calls.push(params); return { rows: [] }; } };
  await assert.rejects(listCustomerReturns('customer', database, { orderId: 'invalid' }), error => error.status === 400);
  assert.equal(calls.length, 0);
  await listCustomerReturns('customer', database, { orderId: ORDER, statuses: ['received'], limit: 10, offset: 20 });
  assert.deepEqual(calls[0], ['customer', 10, 20, ['received'], ORDER]);
  await listCustomerReturns('customer', database);
  assert.deepEqual(calls[1], ['customer', 100, 0, null, null]);
});

test('defect reports close immediately after the exact 48-hour delivery boundary', () => {
  const atBoundary = evaluateEligibility(order(DEFECT_WINDOW_MS), items(), NOW);
  assert.equal(atBoundary.requestTypes.find(type => type.code === RETURN_TYPES.defect).eligible, true);
  assert.equal(atBoundary.requestTypes.find(type => type.code === RETURN_TYPES.return).eligible, true);

  const justAfter = evaluateEligibility(order(DEFECT_WINDOW_MS + 1), items(), NOW);
  assert.equal(justAfter.requestTypes.find(type => type.code === RETURN_TYPES.defect).eligible, false);
  assert.equal(justAfter.requestTypes.find(type => type.code === RETURN_TYPES.return).eligible, true);
  assert.equal(justAfter.defectReportingEnded, true);
});

test('normal returns and size replacements close immediately after the exact seven-day delivery boundary', () => {
  const atBoundary = evaluateEligibility(order(RETURN_WINDOW_MS), items(), NOW);
  assert.equal(atBoundary.requestTypes.find(type => type.code === RETURN_TYPES.return).eligible, true);
  assert.equal(atBoundary.requestTypes.find(type => type.code === RETURN_TYPES.replacement).eligible, true);

  const justAfter = evaluateEligibility(order(RETURN_WINDOW_MS + 1), items(), NOW);
  assert.equal(justAfter.requestTypes.find(type => type.code === RETURN_TYPES.return).eligible, false);
  assert.equal(justAfter.requestTypes.find(type => type.code === RETURN_TYPES.replacement).eligible, false);
  assert.equal(justAfter.reason, 'WINDOW_CLOSED');
});

test('undelivered, cancelled, RTO, missing timestamp and fully returned orders are ineligible', () => {
  assert.equal(evaluateEligibility(order(0, { order_status: 'confirmed' }), items(), NOW).reason, 'NOT_DELIVERED');
  assert.equal(evaluateEligibility(order(0, { order_status: 'cancelled' }), items(), NOW).eligible, false);
  assert.equal(evaluateEligibility(order(0, { order_status: 'rto' }), items(), NOW).eligible, false);
  assert.equal(evaluateEligibility(order(0, { delivered_at: null }), items(), NOW).reason, 'DELIVERY_TIME_MISSING');
  assert.equal(evaluateEligibility(order(0), items(2), NOW).reason, 'FULLY_RETURNED');
});

test('request validation requires server reason codes, quantities, ownership IDs and Other explanation', () => {
  const valid = { orderId: ORDER, idempotencyKey: IDEM, items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] };
  assert.equal(validateRequest(valid).items[0].reason, 'size_issue');
  for (const body of [
    { ...valid, orderId: 'foreign-order' },
    { ...valid, idempotencyKey: 'retry' },
    { ...valid, items: [{ orderItemId: ITEM, quantity: 0, reason: 'size_issue' }] },
    { ...valid, items: [{ orderItemId: ITEM, quantity: 1, reason: 'invented' }] },
    { ...valid, items: [{ orderItemId: ITEM, quantity: 1, reason: 'other' }] },
    { ...valid, items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }, { orderItemId: ITEM, quantity: 1, reason: 'quality_issue' }] }
  ]) assert.throws(() => validateRequest(body));
});

test('each selected size-exchange item carries its own replacement size and cannot use a shared payload value', () => {
  const exchange = validateRequest({ orderId: ORDER, idempotencyKey: IDEM, requestType: RETURN_TYPES.replacement,
    items: [
      { orderItemId: ITEM, quantity: 1, reason: 'size_issue', replacementSize: 'L' },
      { orderItemId: OTHER, quantity: 1, reason: 'size_issue', replacementSize: 'XL' }
    ]
  });
  assert.equal(exchange.items.length, 2);
  assert.equal(exchange.items[0].replacementSize, 'L');
  assert.equal(exchange.items[1].replacementSize, 'XL');
  assert.equal(exchange.replacementSize, null);
  assert.throws(() => validateRequest({ ...exchange, items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] }), /Replacement size/);
});

test('a client cannot relabel a defect as a normal return to bypass the 48-hour policy', async () => {
  const relabelled = {
    orderId: ORDER, idempotencyKey: IDEM, requestType: RETURN_TYPES.return,
    items: [{ orderItemId: ITEM, quantity: 1, reason: 'product_damaged', comments: 'The garment arrived torn.' }]
  };
  assert.throws(() => validateRequest(relabelled), /Report a defect/);

  const defect = validateRequest({ ...relabelled, requestType: RETURN_TYPES.defect });
  await assert.rejects(
    createLocalReturn('customer', defect, localDatabase({ deliveredAt: new Date(NOW - DEFECT_WINDOW_MS - 1) }), () => NOW),
    error => error.code === 'DEFECT_WINDOW_CLOSED'
  );
});

test('partial refund allocation uses original snapshots, allocates discount in paise, and excludes charges', () => {
  const source = [
    { id: ITEM, quantity: 2, unit_price: '100.00' },
    { id: OTHER, quantity: 1, unit_price: '50.00' }
  ];
  const allocated = refundableItems({ subtotal: '250.00', discount_amount: '25.00', shipping_amount: '100.00' }, source);
  assert.equal(allocated[0].refundFor(0, 1), 9000);
  assert.equal(allocated[0].refundFor(1, 1), 9000);
  assert.equal(allocated[1].refundFor(0, 1), 4500);
  assert.equal(allocated.reduce((sum, item) => sum + item.refundFor(0, item.quantity), 0), 22500);
});

function localDatabase({ owner = true, returned = 0, deliveredAt = new Date(NOW), status = 'delivered', duplicate = null, additionalItem = false } = {}) {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql: String(sql), params });
    if (String(sql).startsWith('SELECT * FROM return_requests WHERE user_id')) return { rows: duplicate ? [duplicate] : [] };
    if (String(sql).startsWith('SELECT o.*, u.email')) return { rows: owner ? [{ ...order(0, { delivered_at: deliveredAt, order_status: status }), customer_email: 'buyer@example.com' }] : [] };
    if (String(sql).startsWith('SELECT oi.*')) return { rows: additionalItem
      ? [{ ...items(returned)[0], quantity: 1 }, { ...items()[0], id: OTHER, quantity: 1 }] : items(returned) };
    if (String(sql).startsWith('INSERT INTO return_requests')) return { rows: [{ id: RETURN, order_id: ORDER, request_hash: params[7], status: 'requested' }] };
    return { rows: [] };
  }, release() {} };
  return { queries, connect: async () => client };
}

test('local return transaction enforces ownership, window and remaining quantities without restoring inventory', async () => {
  const body = validateRequest({ orderId: ORDER, idempotencyKey: IDEM, items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] });
  const db = localDatabase({ returned: 1 });
  const result = await createLocalReturn('customer', body, db, () => NOW);
  assert.equal(result.created, true);
  assert.equal(db.queries.filter(query => query.sql.startsWith('INSERT INTO return_items')).length, 1);
  assert.equal(db.queries.some(query => query.sql.includes('UPDATE product_variants')), false);
  await assert.rejects(createLocalReturn('customer', body, localDatabase({ owner: false }), () => NOW), error => error.status === 404);
  await assert.rejects(createLocalReturn('customer', body, localDatabase({ returned: 2 }), () => NOW), /already have a return request/);
});

test('a fully requested product stays blocked while other products remain available', async () => {
  const blocked = validateRequest({ orderId: ORDER, idempotencyKey: IDEM,
    items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] });
  const db = localDatabase({ returned: 1, additionalItem: true });
  await assert.rejects(createLocalReturn('customer', blocked, db, () => NOW), error =>
    error.code === 'RETURN_ITEM_ALREADY_REQUESTED' && error.details.orderItemId === ITEM);
  assert.equal(db.queries.some(query => query.sql.startsWith('INSERT INTO return_requests')), false);
  const allowed = validateRequest({ orderId: ORDER, idempotencyKey: IDEM,
    items: [{ orderItemId: OTHER, quantity: 1, reason: 'changed_mind' }] });
  assert.equal((await createLocalReturn('customer', allowed, localDatabase({ returned: 1, additionalItem: true }), () => NOW)).created, true);
});

test('remaining units can be requested, but an existing request cannot cause quantities to exceed the purchase', async () => {
  const remaining = validateRequest({ orderId: ORDER, idempotencyKey: IDEM,
    items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] });
  assert.equal((await createLocalReturn('customer', remaining, localDatabase({ returned: 1 }), () => NOW)).created, true);
  const excess = validateRequest({ orderId: ORDER, idempotencyKey: IDEM,
    items: [{ orderItemId: ITEM, quantity: 2, reason: 'size_issue' }] });
  const database = localDatabase({ returned: 1 });
  await assert.rejects(createLocalReturn('customer', excess, database, () => NOW), error => error.code === 'RETURN_QUANTITY_EXCEEDED');
  assert.equal(database.queries.some(query => query.sql.startsWith('INSERT INTO return_requests')), false);
});

test('same idempotency key replays the local return and a conflicting body is rejected', async () => {
  const first = validateRequest({ orderId: ORDER, idempotencyKey: IDEM, items: [{ orderItemId: ITEM, quantity: 1, reason: 'size_issue' }] });
  const replay = localDatabase({ duplicate: { id: RETURN, request_hash: first.requestHash } });
  assert.equal((await createLocalReturn('customer', first, replay, () => NOW)).created, false);
  const changed = validateRequest({ orderId: ORDER, idempotencyKey: IDEM, items: [{ orderItemId: ITEM, quantity: 1, reason: 'quality_issue', comments: 'Stitching is damaged.' }] });
  await assert.rejects(createLocalReturn('customer', changed, localDatabase({ duplicate: { id: RETURN, request_hash: first.requestHash } })), /different items/);
});

const env = {
  ...packingEnvironment,
  SHIPROCKET_PACKAGE_WEIGHT_KG: '0.5', SHIPROCKET_PACKAGE_LENGTH_CM: '20', SHIPROCKET_PACKAGE_BREADTH_CM: '15', SHIPROCKET_PACKAGE_HEIGHT_CM: '5',
  SHIPROCKET_PICKUP_LOCATION: 'work'
};
const savedPickup = (changes = {}) => ({ data: { shipping_address: [{
  id: 123, pickup_location: 'work', name: 'Monk Hagen', address: 'Kabir Apparels Warehouse',
  address_2: 'Industrial Estate', city: 'Delhi', state: 'Delhi', country: 'India', pin_code: '110001',
  email: 'returns@example.com', phone: '9876543210', ...changes
}] } });
const pickupApi = (changes = {}) => ({ request: async path => {
  assert.equal(path, '/settings/company/pickup');
  return savedPickup(changes);
} });
function payloadDatabase(changes = {}) {
  return { query: async () => ({ rows: [{
    id: RETURN, return_number: 'R-123', refund_amount: '90.00', customer_email: 'buyer@example.com',
    full_name: 'Buyer Name', phone: '+91 98765 43210', address_line1: 'Customer Home', address_line2: 'Street 2', landmark: 'Park',
    city: 'Mumbai', state: 'Maharashtra', country: 'India', postal_code: '400001',
    items: [{ sku: 'TEE-M-BLUE', variantId: OTHER, id: ITEM, name: 'Original tee', size: 'M', quantity: 1, unitPrice: '100.00', refundAmount: '90.00' }],
    ...changes
  }] }) };
}

test('Shiprocket return payload uses customer pickup and the saved forward pickup location as its destination', async () => {
  const payload = await returnPayload(payloadDatabase(), RETURN, env, pickupApi());
  assert.equal(payload.pickup_address, 'Customer Home');
  assert.equal(payload.pickup_phone, '9876543210');
  assert.equal(payload.shipping_address, 'Kabir Apparels Warehouse');
  assert.equal(payload.shipping_pincode, 110001);
  assert.deepEqual(payload.order_items[0], { sku: 'TEE-M-BLUE', name: 'Original tee', units: 1, selling_price: 100, tax: 5, discount: 10, qc_enable: false, qc_size: 'M' });
  assert.equal(Object.hasOwn(payload, 'request_pickup'), false);
  assert.equal(payload.weight, 0.3);
  assert.equal(payload.length, 27);
  assert.equal(payload.breadth, 33);
  assert.equal(payload.height, 2.6);
});

test('a partial return packs only requested units, summed across product lines', async () => {
  const product = { sku: 'TEE', name: 'Original tee', size: 'M', unitPrice: '100.00' };
  const payload = await returnPayload(payloadDatabase({ items: [
    { ...product, quantity: 2, refundAmount: '180.00' },
    { ...product, quantity: 1, refundAmount: '90.00' }
  ] }), RETURN, { ...packingEnvironment, SHIPROCKET_PICKUP_LOCATION: 'work' }, pickupApi());
  assert.equal(payload.weight, 0.83);
  assert.equal(payload.height, 5.08);
});

test('Shiprocket return payload rejects invalid customer and saved-location pincodes', async () => {
  await assert.rejects(returnPayload(payloadDatabase({ postal_code: 'invalid' }), RETURN, env, pickupApi()),
    error => error.code === 'RETURN_ADDRESS_REVIEW');
  await assert.rejects(returnPayload(payloadDatabase(), RETURN, env, pickupApi({ pin_code: '000000' })),
    error => error.code === 'RETURN_WAREHOUSE_NOT_CONFIGURED');
});

test('return warehouse resolution requires one exact, complete saved Shiprocket pickup location', async () => {
  const none = { request: async () => savedPickup({ pickup_location: 'another-location' }) };
  await assert.rejects(resolveReturnWarehouse(none, env), error => error.code === 'RETURN_WAREHOUSE_NOT_CONFIGURED');
  await assert.rejects(resolveReturnWarehouse(pickupApi({ phone: '' }), env),
    error => error.code === 'RETURN_WAREHOUSE_NOT_CONFIGURED');
  await assert.rejects(resolveReturnWarehouse(pickupApi(), {}),
    error => error.code === 'RETURN_WAREHOUSE_NOT_CONFIGURED');
});

test('return provisioning creates a return order without scheduling pickup', async () => {
  let claims = 0; let locationCalls = 0; let mutationCalls = 0; const updates = [];
  const database = { async query(sql) {
    sql = String(sql); updates.push(sql);
    if (sql.startsWith('UPDATE return_requests SET pending_operation')) return { rows: claims++ === 0 ? [{ id: RETURN }] : [] };
    if (sql.startsWith('SELECT rr.id, rr.return_number')) return payloadDatabase().query();
    if (sql.startsWith('SELECT rr.*, o.order_number')) return { rows: [{ id: RETURN, order_id: ORDER, return_number: 'R-123', status: claims > 1 ? 'return_created' : 'requested', refund_amount: '90', refund_status: 'pending', items: [] }] };
    return { rows: [] };
  } };
  const api = { request: async path => {
    if (path === '/settings/company/pickup') { locationCalls += 1; return savedPickup(); }
    mutationCalls += 1; assert.equal(path, '/orders/create/return');
    return { order_id: 11, shipment_id: 22, status: 'NEW', status_code: 1 };
  } };
  await provisionReturn(RETURN, { database, api, env });
  await provisionReturn(RETURN, { database, api, env });
  assert.equal(locationCalls, 1);
  assert.equal(mutationCalls, 1);
});

test('reverse webhook labels normalize through pickup, transit, receipt and failure states', () => {
  const cases = [
    ['RETURN INITIATED', 'pickup_scheduled'], ['RETURN PICKUP QUEUED', 'pickup_scheduled'],
    ['Return Pickup Generated', 'pickup_scheduled'], ['RETURN PICKUP RESCHEDULED', 'pickup_scheduled'],
    ['RETURN OUT FOR PICKUP', 'pickup_scheduled'], ['RETURN PICKED UP', 'picked_up'],
    ['RETURN_IN_TRANSIT', 'in_transit'], ['RETURN OUT FOR DELIVERY', 'in_transit'],
    ['RETURN DELIVERED', 'received'], ['REACHED WAREHOUSE', 'received'],
    ['RETURN PICKUP ERROR', 'pickup_failed'], ['RETURN PICKUP EXCEPTION', 'pickup_failed'],
    ['RETURN UNDELIVERED', 'pickup_failed'], ['RETURN CANCELLATION REQUESTED', 'cancelled'],
    ['RETURN PICKUP CANCELLED', 'cancelled']
  ];
  for (const [label, expected] of cases) {
    assert.equal(mappedWebhookStatus({ shipment_status: label }), expected, label);
  }
});

test('shipment tracking status IDs retain their documented meanings for return webhooks', () => {
  const cases = new Map([
    [3, 'pickup_scheduled'], [4, 'pickup_scheduled'], [15, 'pickup_scheduled'], [19, 'pickup_scheduled'],
    [42, 'picked_up'], [18, 'in_transit'], [38, 'in_transit'], [46, 'in_transit'],
    [7, 'received'], [48, 'received'], [13, 'pickup_failed'], [20, 'pickup_failed'],
    [8, 'cancelled'], [16, 'cancelled'], [45, 'cancelled']
  ]);
  for (const [code, expected] of cases) {
    assert.equal(mappedWebhookStatus({ shipment_status_id: code }), expected, `shipment_status_id ${code}`);
    assert.equal(mappedWebhookStatus({ current_status_id: String(code) }), expected, `current_status_id ${code}`);
  }
});

test('return-order numeric statuses normalize without colliding with shipment status IDs', () => {
  const cases = new Map([
    [21, 'return_created'], [22, 'pickup_scheduled'], [23, 'pickup_scheduled'], [28, 'pickup_scheduled'],
    [31, 'pickup_scheduled'], [47, 'pickup_scheduled'], [32, 'picked_up'], [25, 'in_transit'],
    [48, 'in_transit'], [90, 'in_transit'], [26, 'received'], [58, 'received'],
    [68, 'received'], [81, 'received'], [24, 'pickup_failed'], [49, 'pickup_failed'], [57, 'pickup_failed'],
    [50, 'pickup_failed'], [27, 'cancelled'], [29, 'cancelled'], [30, 'cancelled']
  ]);
  for (const [code, expected] of cases) {
    assert.equal(mappedWebhookStatus({ status_code: code }), expected, `status_code ${code}`);
    assert.equal(mappedWebhookStatus({ status: String(code) }), expected, `status ${code}`);
  }
  assert.equal(mappedWebhookStatus({ shipment_status_id: 48 }), 'received');
  assert.equal(mappedWebhookStatus({ status_code: 48 }), 'in_transit');
  assert.equal(mappedWebhookStatus({ current_status_id: 22 }), null);
  assert.equal(mappedWebhookStatus({ status_code: 22 }), 'pickup_scheduled');
  assert.equal(mappedWebhookStatus({ status_code: 200, status: 26 }), 'received');
  assert.equal(mappedWebhookStatus({ 'sr-status': '48' }), 'received');
  assert.equal(mappedWebhookStatus({ shipment_status_id: 51 }), null);
  assert.equal(mappedWebhookStatus({ status_code: 51 }), 'picked_up');
});

test('text labels take precedence over conflicting numeric fields', () => {
  assert.equal(mappedWebhookStatus({ shipment_status_id: 18, shipment_status: 'RETURN DELIVERED' }), 'received');
  assert.equal(mappedWebhookStatus({ status_code: 26, current_status: 'RETURN PICKED UP' }), 'picked_up');
  assert.equal(mappedWebhookStatus({ status_code: 22, status_label: 'RETURN PICKUP ERROR' }), 'pickup_failed');
  assert.equal(mappedWebhookStatus({ shipment_status: 'UNRECOGNIZED', status_code: 999 }), null);
});

test('definitive Shiprocket failure is stored as retryable without losing the local request', async () => {
  let failedUpdate;
  const database = { async query(sql, params) {
    sql = String(sql);
    if (sql.startsWith('UPDATE return_requests SET pending_operation')) return { rows: [{ id: RETURN }] };
    if (sql.startsWith('SELECT rr.id, rr.return_number')) return payloadDatabase().query();
    if (sql.includes('SET status = $1, last_error_code')) { failedUpdate = params; return { rows: [] }; }
    if (sql.startsWith('SELECT rr.*, o.order_number')) return { rows: [{ id: RETURN, return_number: 'R-123', status: 'shiprocket_failed', refund_amount: 90, refund_status: 'pending', items: [] }] };
    return { rows: [] };
  } };
  const api = { request: async path => {
    if (path === '/settings/company/pickup') return savedPickup();
    throw shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'private');
  } };
  await provisionReturn(RETURN, { database, env, api });
  assert.equal(failedUpdate[0], 'shiprocket_failed');
  assert.equal(failedUpdate[2], false);
});

function rejectionDatabase(changes = {}) {
  const state = {
    id: RETURN, order_id: ORDER, return_number: 'R-123', status: 'return_created',
    refund_status: 'pending', refund_amount: '90.00', inventory_restored_at: null,
    shiprocket_return_order_id: 12345, pending_operation: null, operation_started_at: null,
    last_error_code: null, items: [], ...changes
  };
  const query = async (sql, params = []) => {
    sql = String(sql);
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT * FROM return_requests')) return { rows: [{ ...state }] };
    if (sql.includes("SET status = 'rejected'")) {
      state.status = 'rejected'; state.refund_status = 'not_applicable'; state.pending_operation = null;
      return { rows: [] };
    }
    if (sql.includes("SET pending_operation = 'cancel'")) {
      state.pending_operation = 'cancel'; state.last_error_code = null;
      return { rows: [] };
    }
    if (sql.includes("SET status = 'cancelled'")) {
      state.status = 'cancelled'; state.refund_status = 'not_applicable'; state.pending_operation = null;
      return { rows: [] };
    }
    if (sql.includes('pending_operation = CASE WHEN $2')) {
      if (!params[1]) state.pending_operation = null;
      state.last_error_code = params[2];
      return { rows: [] };
    }
    if (sql.startsWith('SELECT rr.*, o.order_number')) return { rows: [{ ...state }] };
    return { rows: [] };
  };
  return { state, query, connect: async () => ({ query, release() {} }) };
}

test('local rejection requires confirmation for an uncertain create and never calls Shiprocket', async () => {
  const database = rejectionDatabase({ status: 'requested', shiprocket_return_order_id: null, pending_operation: 'create' });
  const api = { request: async () => { throw new Error('Shiprocket must not be called'); } };
  await assert.rejects(rejectReturn(RETURN, { database, api }), error => error.code === 'RETURN_REMOTE_CONFIRMATION_REQUIRED');
  assert.equal(database.state.status, 'requested');
  const result = await rejectReturn(RETURN, { database, api, confirmedNoRemote: true });
  assert.equal(result.status, 'rejected');
  assert.equal(database.state.pending_operation, null);
});

test('created Shiprocket returns are cancelled remotely before local cancellation', async () => {
  const database = rejectionDatabase();
  let calls = 0;
  const api = { request: async (path, options) => {
    calls += 1;
    assert.equal(path, '/orders/cancel');
    assert.deepEqual(options.body, { ids: [12345] });
    assert.equal(options.acceptEmptyResponse, true);
    return {};
  } };
  const result = await rejectReturn(RETURN, { database, api });
  assert.equal(calls, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal(database.state.refund_status, 'not_applicable');
});

test('uncertain remote cancellation stays pending reconciliation and never becomes locally cancelled', async () => {
  const database = rejectionDatabase();
  const api = { request: async () => { throw shippingError(504, 'SHIPROCKET_TIMEOUT', 'private', true); } };
  await assert.rejects(rejectReturn(RETURN, { database, api }),
    error => error.code === 'RETURN_CANCELLATION_RECONCILIATION_REQUIRED');
  assert.equal(database.state.status, 'return_created');
  assert.equal(database.state.pending_operation, 'cancel');
  assert.equal(database.state.last_error_code, 'RETURN_CANCELLATION_RECONCILIATION_REQUIRED');
});

test('picked-up returns cannot be cancelled, while received returns can be rejected after inspection', async () => {
  let calls = 0;
  const api = { request: async () => { calls += 1; } };
  const moving = rejectionDatabase({ status: 'picked_up' });
  await assert.rejects(rejectReturn(RETURN, { database: moving, api }),
    error => error.code === 'RETURN_CANCELLATION_UNAVAILABLE');
  assert.equal(moving.state.status, 'picked_up');
  const received = rejectionDatabase({ status: 'received' });
  const result = await rejectReturn(RETURN, { database: received, api });
  assert.equal(result.status, 'rejected');
  assert.equal(calls, 0);
});

function adminDatabase(paymentMethod = 'razorpay') {
  const state = { status: 'received', refund_status: 'pending', inventory_restored_at: null, stockAdds: 0, gatewayUpdates: 0 };
  const row = () => ({ id: RETURN, order_id: ORDER, return_number: 'R-123', status: state.status,
    refund_status: state.refund_status, refund_amount: '90.00', inventory_restored_at: state.inventory_restored_at,
    payment_method: paymentMethod, razorpay_payment_id: paymentMethod === 'razorpay' ? 'pay_original' : null,
    pending_operation: null, items: [] });
  const query = async (sql, params) => {
    sql = String(sql);
    if (sql.startsWith('SELECT rr.*, o.payment_method')) return { rows: [row()] };
    if (sql.startsWith('SELECT psd.id AS inventory_id')) return { rows: [{ inventory_id: INVENTORY,
      product_id: PRODUCT, size_id: SIZE, quantity: 1 }] };
    if (sql.startsWith('UPDATE product_size_details')) { state.stockAdds += Number(params[0]);
      return { rows: [{ quantity_before: 0, quantity_after: state.stockAdds }] }; }
    if (sql.startsWith('INSERT INTO inventory_movements')) return { rows: [{ id: '80000000-0000-4000-8000-000000000001' }] };
    if (sql.includes("inventory_restored_at = NOW()")) { state.inventory_restored_at = new Date(); state.status = 'approved'; state.refund_status = paymentMethod === 'cod' ? 'manual_required' : 'pending'; return { rows: [] }; }
    if (sql.startsWith('SELECT rr.*, o.order_number')) return { rows: [row()] };
    if (sql.includes("refund_status = 'manual_required'")) { state.refund_status = 'manual_required'; return { rows: [] }; }
    if (sql.includes("status = 'refund_initiated'")) { state.status = 'refund_initiated'; state.refund_status = 'processing'; return { rows: [] }; }
    if (sql.includes('razorpay_refund_id = $1')) { state.gatewayUpdates += 1; return { rows: [] }; }
    return { rows: [] };
  };
  const client = { query, release() {} };
  return { state, query, connect: async () => client };
}

test('inventory is restored only once, and only after a received return is approved', async () => {
  const db = adminDatabase();
  await approveReturn(RETURN, db);
  await approveReturn(RETURN, db);
  assert.equal(db.state.stockAdds, 1);
  assert.equal(db.state.status, 'approved');
});

test('prepaid refund calls Razorpay once while COD remains manual and never calls Razorpay', async () => {
  const prepaid = adminDatabase('razorpay'); prepaid.state.status = 'approved'; prepaid.state.inventory_restored_at = new Date();
  let refundCalls = 0;
  await initiateRefund(RETURN, { database: prepaid, gateway: () => ({ razorpay: { payments: { refund: async (paymentId, body) => {
    refundCalls += 1; assert.equal(paymentId, 'pay_original'); assert.equal(body.amount, 9000); return { id: 'rfnd_mock1', status: 'pending' };
  } } } }) });
  assert.equal(refundCalls, 1);
  assert.equal(prepaid.state.gatewayUpdates, 1);

  const cod = adminDatabase('cod'); cod.state.status = 'approved'; cod.state.inventory_restored_at = new Date();
  await initiateRefund(RETURN, { database: cod, gateway: () => { throw new Error('COD must not initialize Razorpay'); } });
  assert.equal(cod.state.refund_status, 'manual_required');
});

test('notification failure does not fail return approval or undo a successfully created refund', async () => {
  const throwingNotifications = {
    returnApproved: async () => { throw new Error('mock email failure'); },
    refundInitiated: async () => { throw new Error('mock email failure'); },
    refundFailure: async () => { throw new Error('mock email failure'); }
  };
  const received = adminDatabase('razorpay');
  const approved = await approveReturn(RETURN, received, throwingNotifications);
  assert.equal(approved.status, 'approved');
  const result = await initiateRefund(RETURN, { database: received, notifications: throwingNotifications,
    gateway: () => ({ razorpay: { payments: { refund: async () => ({ id: 'rfnd_mocksafe', status: 'pending' }) } } }) });
  assert.equal(result.status, 'refund_initiated');
  assert.equal(received.state.gatewayUpdates, 1);
});

test('signed Shiprocket webhook advances a return once and duplicate delivery is harmless', async () => {
  const events = new Set(); let updates = 0;
  const client = { async query(sql, params) {
    sql = String(sql);
    if (sql.startsWith('INSERT INTO return_webhook_events')) {
      if (events.has(params[0])) return { rows: [] }; events.add(params[0]); return { rows: [{ event_id: params[0] }] };
    }
    if (sql.startsWith('SELECT * FROM return_requests')) return { rows: [{ id: RETURN, status: 'return_created' }] };
    if (sql.startsWith('UPDATE return_requests SET status')) { updates += 1; return { rows: [] }; }
    return { rows: [] };
  }, release() {} };
  const database = { connect: async () => client };
  const payload = { awb: 'AWB1', order_id: 'R-123', sr_order_id: 11, shipment_status_id: 42, shipment_status: 'PICKED UP' };
  const headers = { 'x-api-key': 'webhook-secret' };
  assert.equal((await processShiprocketWebhook(payload, headers, database, { SHIPROCKET_WEBHOOK_SECRET: 'webhook-secret' })).duplicate, false);
  assert.equal((await processShiprocketWebhook(payload, headers, database, { SHIPROCKET_WEBHOOK_SECRET: 'webhook-secret' })).duplicate, true);
  assert.equal(updates, 1);
});
