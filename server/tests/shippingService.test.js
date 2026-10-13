const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createShippingService } = require('../services/shippingService');
const { shippingError } = require('../config/shiprocket');
const { buildOrderPayload, packageDetails, packageForItems, serviceabilityInput, normalizeCouriers, normalizeTracking } = require('../services/shippingMapping');
const { environment: packingEnvironment } = require('./helpers/shippingPackageFixtures');

const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const parcel = { pickup_location: 'Test warehouse', weight: 0.5, length: 25, breadth: 20, height: 5 };
const orderFixture = () => ({
  id: ORDER_ID, order_number: 'MH-TEST-001', user_id: USER_ID, payment_method: 'razorpay', payment_status: 'paid', order_status: 'confirmed',
  razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', paid_at: new Date(),
  created_at: '2026-09-13T04:00:00Z', customer_email: 'customer@example.test',
  subtotal: '1499.00', discount_amount: '0', shipping_amount: '99', total_amount: '1598'
});
const address = { full_name: 'Test Customer', address_line1: '123 Test Street', city: 'Delhi', state: 'Delhi',
  postal_code: '110001', country: 'India', phone: '+91 9876543210', email: 'delivery@example.test' };
const items = [{ id: 'line-1', variant_id: 'variant-1', product_name: 'Test Tee', size: 'M', quantity: 1, unit_price: '1499', sku: 'TEE-M-BLACK' }];

function setup({ order = orderFixture(), request, downloadInvoice, row: initial, environment = packingEnvironment } = {}) {
  let row = initial || null;
  let locked = false;
  const calls = [];
  const repository = {
    format: record => ({ ...record }),
    async withLock(_id, fn) {
      if (locked) throw shippingError(409, 'SHIPPING_BUSY', 'Busy');
      locked = true;
      try { return await fn({}); } finally { locked = false; }
    },
    async order() { return order; },
    async find() { return row; },
    async invoiceSource() { return order ? { id: order.id, user_id: order.user_id,
      order_number: order.order_number, shiprocket_order_id: row?.shiprocket_order_id ?? null } : null; },
    async enqueue() { row ||= { order_id: ORDER_ID, shipping_status: 'pending', attempt_count: 0, pickup_status: 'pending' }; },
    async details() { return { address, items }; },
    async patch(_client, _id, changes) { row = { ...row, ...changes }; return row; },
    async save(client, id, changes) { return this.patch(client, id, changes); }
  };
  const api = {
    async request(path, options) {
      calls.push({ path, options });
      return request ? request(path, options) : { order_id: 101, shipment_id: 202 };
    },
    async downloadInvoice(url) {
      calls.push({ path: url, download: true });
      return downloadInvoice ? downloadInvoice(url) : Buffer.from('%PDF-1.4 test invoice');
    }
  };
  return { service: createShippingService({ repository, api, environment }), calls, repository, getRow: () => row };
}

test('maps immutable order snapshots, INR totals, variant SKUs and package units', () => {
  const body = buildOrderPayload(orderFixture(), address, items, parcel, packingEnvironment);
  assert.equal(body.order_id, ORDER_ID);
  assert.equal(body.order_date, '2026-09-13 09:30');
  assert.equal(body.payment_method, 'Prepaid');
  assert.equal(body.shipping_is_billing, true);
  assert.equal(body.billing_customer_name, 'Test');
  assert.equal(body.billing_last_name, 'Customer');
  assert.equal(body.billing_phone, '9876543210');
  assert.equal(body.billing_city, 'Delhi');
  assert.equal(body.billing_state, 'Delhi');
  assert.equal(body.billing_pincode, '110001');
  assert.equal(body.billing_country, 'India');
  assert.equal(body.sub_total, 1499);
  assert.equal(body.shipping_charges, 99);
  assert.deepEqual(body.order_items[0], { name: 'Test Tee - Size M', sku: 'TEE-M-BLACK', units: 1, selling_price: 1499, tax: 5 });
  assert.equal(body.weight, 0.5);
  assert.equal(body.length, 25);
  assert.equal(body.order_items[0].tax, 5);
  const codPayload = buildOrderPayload({ ...orderFixture(), payment_method: 'cod', payment_status: 'pending' }, address, items, parcel, packingEnvironment);
  assert.equal(codPayload.payment_method, 'COD');
  assert.equal(codPayload.sub_total, 1499);
  assert.equal(codPayload.shipping_charges, 99);
  assert.throws(() => buildOrderPayload({ ...orderFixture(), total_amount: 1 }, address, items, parcel, packingEnvironment));
});

test('shipment payload uses the delivery email, not an account or store fallback email', () => {
  const phoneOnlyAccount = buildOrderPayload({ ...orderFixture(), customer_email: null }, address, items, parcel, packingEnvironment);
  const accountEmailDiffers = buildOrderPayload({ ...orderFixture(), customer_email: 'account@example.test' }, address, items, parcel, packingEnvironment);

  assert.equal(phoneOnlyAccount.billing_email, 'delivery@example.test');
  assert.equal(accountEmailDiffers.billing_email, 'delivery@example.test');
  assert.throws(() => buildOrderPayload(orderFixture(), { ...address, email: null }, items, parcel, packingEnvironment),
    error => error.code === 'SHIPPING_VALIDATION');
});

test('a confirmed order with a corrected delivery email safely retries shipment creation once', async () => {
  const fixture = setup({ order: { ...orderFixture(), customer_email: null } });
  const originalDetails = fixture.repository.details;
  fixture.repository.details = async () => ({ address: { ...address, email: null }, items });

  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPPING_VALIDATION');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.getRow().shipping_status, 'validation_failed');
  assert.equal(fixture.getRow().pending_operation ?? null, null);
  assert.equal(fixture.getRow().shiprocket_shipment_id, undefined);

  fixture.repository.details = originalDetails;
  await fixture.service.createShipment(ORDER_ID, parcel);
  await fixture.service.createShipment(ORDER_ID);

  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.getRow().shiprocket_shipment_id, 202);
});

test('rejects unpaid, failed, refunded, cancelled and unverified prepaid orders without remote calls', async () => {
  for (const changes of [{ payment_status: 'pending' }, { payment_status: 'failed' }, { payment_status: 'refunded' },
    { order_status: 'cancelled' }, { paid_at: null }, { razorpay_payment_id: null }, { payment_method: 'prepaid' }]) {
    const fixture = setup({ order: { ...orderFixture(), ...changes } });
    await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel));
    assert.equal(fixture.calls.length, 0);
  }
});

test('configuration and serviceability inputs are validated without guessing package dimensions', () => {
  assert.throws(() => packageDetails({}, {}), error => error.code === 'SHIPPING_PACKAGE_NOT_CONFIGURED');
  for (const weight of [0, -1, 'abc', true, [], Infinity]) {
    assert.throws(() => serviceabilityInput({ pickup_postcode: '110001', delivery_postcode: '560001', weight, cod: false }));
  }
  assert.throws(() => serviceabilityInput({ pickup_postcode: 'invalid', delivery_postcode: '560001', weight: 1, cod: 0 }));
  assert.throws(() => serviceabilityInput({ pickup_postcode: '110001', delivery_postcode: '560001', weight: 1, cod: 'false' }));
  assert.equal(serviceabilityInput({ pickup_postcode: '110001', delivery_postcode: '560001', weight: '0.5', cod: '1' }).cod, 1);
});

test('packing counts units across products, applies the 5+ tier, and rejects invalid quantities', () => {
  assert.deepEqual(packageForItems([{ quantity: '2' }, { quantity: 1 }], packingEnvironment), { weight: 0.83, length: 29.21, breadth: 33.02, height: 5.08 });
  assert.deepEqual(packageForItems([{ units: 4 }], packingEnvironment), { weight: 1.1, length: 30.5, breadth: 33.02, height: 7.15 });
  assert.deepEqual(packageForItems([{ quantity: 5 }], packingEnvironment), packageForItems([{ quantity: 20 }], packingEnvironment));
  for (const quantity of [0, -1, 1.5, true, null, 'invalid']) assert.throws(() => packageForItems([{ quantity }]));
  assert.throws(() => packageForItems([]));
  assert.throws(() => packageForItems([{ quantity: Number.MAX_SAFE_INTEGER }, { quantity: 1 }]));
  const oldEnvironment = { ...packingEnvironment, SHIPROCKET_PICKUP_LOCATION: 'work', SHIPROCKET_PACKAGE_WEIGHT_KG: '9', SHIPROCKET_PACKAGE_LENGTH_CM: '99' };
  assert.equal(packageDetails({}, oldEnvironment, [{ quantity: 1 }]).weight, 0.3);
  assert.equal(packageDetails({ height: 6 }, oldEnvironment, [{ quantity: 1 }]).height, 6);
});

test('Shiprocket product tax is an environment percentage while prices and payment totals stay inclusive', () => {
  const discounted = { ...orderFixture(), discount_amount: '149.90', total_amount: '1448.10' };
  const body = buildOrderPayload(discounted, address, items, parcel, packingEnvironment);
  assert.equal(body.order_items[0].tax, 5);
  assert.equal(body.order_items[0].selling_price, 1499);
  assert.equal(body.sub_total, 1349.1);
  assert.equal(body.total_discount, 149.9);
  assert.equal(body.shipping_charges, 99);
  assert.equal(buildOrderPayload(orderFixture(), address, items, parcel, { SHIPROCKET_PRODUCT_TAX_PERCENT: '18' }).order_items[0].tax, 18);
});

test('missing product tax configuration cannot silently create an order without tax', async () => {
  const fixture = setup({ environment: {} });
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPROCKET_NOT_CONFIGURED');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.getRow().shipping_status, 'needs_configuration');
  assert.equal(fixture.getRow().pending_operation ?? null, null);
});

test('new shipments send and persist quantity-based measurements for every tier without fixed package env', async () => {
  const expected = [
    [1, 0.3, 27, 33, 2.6], [2, 0.57, 29.21, 33.02, 3.81],
    [3, 0.83, 29.21, 33.02, 5.08], [4, 1.1, 30.5, 33.02, 7.15],
    [5, 1.45, 33.02, 33.02, 8.9], [10, 1.45, 33.02, 33.02, 8.9]
  ];
  for (const [quantity, weight, length, breadth, height] of expected) {
    const total = 1499 * quantity;
    const fixture = setup({ order: { ...orderFixture(), subtotal: total, shipping_amount: 0, total_amount: total } });
    fixture.repository.details = async () => ({ address, items: [{ ...items[0], quantity }] });
    await fixture.service.createShipment(ORDER_ID, { pickup_location: 'work' });
    const payload = fixture.calls[0].options.body;
    assert.ok(payload.order_items.every(item => item.tax === 5));
    for (const [key, value] of Object.entries({ weight, length, breadth, height })) {
      assert.equal(payload[key], value, `quantity ${quantity}: ${key}`);
      assert.equal(fixture.getRow()[`package_${key}`], value);
    }
    await fixture.service.createShipment(ORDER_ID);
    assert.equal(fixture.calls.length, 1);
  }
});

test('a saved parcel survives a definitive create failure and subsequent retry', async () => {
  let fail = true;
  const fixture = setup({ request: async () => {
    if (fail) throw shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'Temporary provider failure');
    return { order_id: 101, shipment_id: 202 };
  } });
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel));
  fail = false;
  await fixture.service.createShipment(ORDER_ID);
  assert.equal(fixture.calls[1].options.body.weight, parcel.weight);
  assert.equal(fixture.calls[1].options.body.height, parcel.height);
});

test('serviceability exposes only normalized courier information', () => {
  const result = normalizeCouriers({ token: 'never-return', data: { available_courier_companies: [{
    courier_company_id: 43, courier_name: 'Test Courier', freight_charge: '54', rate: '60',
    cod: '1', rating: '4.9', estimated_delivery_days: '4', etd: 'Sep 17, 2026', auth_token: 'never-return'
  }] } });
  assert.equal(result.couriers[0].shippingCharge, 60);
  assert.equal(result.couriers[0].codAvailable, true);
  assert.equal(result.couriers[0].rating, 4.9);
  assert.ok(!JSON.stringify(result).includes('never-return'));
  assert.deepEqual(normalizeCouriers({ data: { available_courier_companies: [] } }), { available: false, currency: 'INR', couriers: [] });
});

test('shipment creation is idempotent; duplicate request uses saved IDs', async () => {
  const fixture = setup();
  const first = await fixture.service.createShipment(ORDER_ID, parcel);
  const second = await fixture.service.createShipment(ORDER_ID);
  assert.equal(first.shiprocket_order_id, 101);
  assert.equal(second.shiprocket_shipment_id, 202);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.getRow().pending_operation, null);
});

test('concurrent shipment creation invokes the remote create endpoint once', async () => {
  let release;
  const fixture = setup({ request: () => new Promise(resolve => { release = resolve; }) });
  const first = fixture.service.createShipment(ORDER_ID, parcel);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPPING_BUSY');
  assert.equal(fixture.getRow().pending_operation, 'create');
  release({ order_id: 101, shipment_id: 202 });
  await first;
  assert.equal(fixture.calls.length, 1);
});

test('timeout or missing remote IDs preserves intent and prevents another create call', async () => {
  for (const response of ['timeout', 'invalid']) {
    const fixture = setup({ request: async () => {
      if (response === 'timeout') throw shippingError(504, 'SHIPROCKET_TIMEOUT', 'Timed out', true);
      return { status: 'NEW' };
    } });
    await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPPING_RECONCILIATION_REQUIRED');
    await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPPING_RECONCILIATION_REQUIRED');
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.getRow().shipping_status, 'needs_review');
  }
});

test('database failure after remote creation never permits an automatic duplicate', async () => {
  const fixture = setup();
  fixture.repository.save = async () => { throw new Error('database write failed'); };
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel), error => error.code === 'SHIPPING_RECONCILIATION_REQUIRED');
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel));
  assert.equal(fixture.calls.length, 1);
});

test('authentication, configuration and permission failures require a controlled admin retry', async () => {
  for (const code of [
    'SHIPROCKET_NOT_CONFIGURED',
    'SHIPROCKET_AUTH_FAILED',
    'SHIPROCKET_PERMISSION_DENIED'
  ]) {
    const fixture = setup({ request: async () => { throw shippingError(503, code, 'Configuration required'); } });
    await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel));
    assert.equal(fixture.getRow().pending_operation, null);
    assert.equal(fixture.getRow().shipping_status, 'needs_configuration');
    assert.ok(fixture.getRow().next_attempt_at > new Date());
  }
});

test('temporary Shiprocket failure preserves the COD order and records a durable retry', async () => {
  const order = { ...orderFixture(), payment_method: 'cod', payment_status: 'pending',
    razorpay_order_id: null, razorpay_payment_id: null, paid_at: null };
  const fixture = setup({ order, request: async () => {
    throw shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'Temporary provider failure');
  } });
  await assert.rejects(fixture.service.createShipment(ORDER_ID, parcel));
  assert.equal(order.payment_method, 'cod');
  assert.equal(order.payment_status, 'pending');
  assert.equal(fixture.getRow().shipping_status, 'retry_pending');
  assert.equal(fixture.getRow().pending_operation, null);
  assert.ok(fixture.getRow().next_attempt_at > new Date());
});

test('AWB, pickup and label enforce prerequisites and reuse successful results', async () => {
  const fixture = setup({ request: async path => {
    if (path.includes('create/adhoc')) return { order_id: 101, shipment_id: 202 };
    if (path.includes('assign/awb')) return { awb_assign_status: 1, response: { data: {
      awb_code: 'TESTAWB', courier_company_id: 43, courier_name: 'Test Courier', shipment_id: 202
    } } };
    if (path.includes('generate/pickup')) return { pickup_status: 1, response: { pickup_scheduled_date: '2026-09-14 12:00:00' } };
    return { label_created: 1, label_url: 'https://example.test/label.pdf' };
  } });
  await assert.rejects(fixture.service.assignAwb(ORDER_ID, 43), error => error.code === 'SHIPMENT_NOT_CREATED');
  await fixture.service.createShipment(ORDER_ID, parcel);
  await assert.rejects(fixture.service.generatePickup(ORDER_ID), error => error.code === 'AWB_NOT_ASSIGNED');
  await fixture.service.assignAwb(ORDER_ID, 43);
  await fixture.service.assignAwb(ORDER_ID, 43);
  await assert.rejects(fixture.service.assignAwb(ORDER_ID, 44), error => error.code === 'COURIER_ALREADY_ASSIGNED');
  await fixture.service.generatePickup(ORDER_ID);
  await fixture.service.generatePickup(ORDER_ID);
  await fixture.service.generateLabel(ORDER_ID);
  await fixture.service.generateLabel(ORDER_ID);
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls[2].options.body, { shipment_id: [202] });
  assert.equal(fixture.getRow().label_url, 'https://example.test/label.pdf');
});

test('tracking checks ownership before contacting Shiprocket, strips provider internals and caches results', async () => {
  const fixture = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: 101, shiprocket_shipment_id: 202, awb_code: 'TESTAWB' },
    request: async () => ({ token: 'private-token', tracking_data: { track_status: 1, shipment_status: 7,
      shipment_track: [{ current_status: 'Delivered', consignee_name: 'private-name', delivered_date: '2026-09-14 12:00:00' }],
      track_url: 'https://example.test/tracking', shipment_track_activities: [{ activity: 'Delivered', location: 'Delhi', secret: 'private-token' }] } }) });
  await assert.rejects(fixture.service.tracking(ORDER_ID, { id: 'another-user', role: 'customer' }), error => error.status === 404);
  assert.equal(fixture.calls.length, 0);
  const result = await fixture.service.tracking(ORDER_ID, { id: USER_ID, role: 'customer' });
  assert.equal(result.trackingStatus, 'Delivered');
  assert.ok(!JSON.stringify(result).includes('private-'));
  assert.ok(!('labelUrl' in result));
  await fixture.service.tracking(ORDER_ID, { id: 'admin-id', role: 'admin' });
  assert.equal(fixture.calls.length, 1);
  assert.equal(normalizeTracking({ tracking_data: { track_status: 0, error: 'provider-private-text' } }).available, false);
});

test('invoice generation checks ownership and uses only the stored Shiprocket order ID', async () => {
  const fixture = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: 101, shiprocket_shipment_id: 202 },
    request: async () => ({ is_invoice_created: true, invoice_url: 'https://example.test/invoice.pdf' }) });
  await assert.rejects(fixture.service.invoice(ORDER_ID, { id: 'another-user', role: 'customer' }),
    error => error.code === 'ORDER_NOT_FOUND');
  assert.equal(fixture.calls.length, 0);
  const own = await fixture.service.invoice(ORDER_ID, { id: USER_ID, role: 'customer' });
  assert.equal(own.filename, 'MH-TEST-001_Invoice_101.pdf');
  assert.equal(own.document.subarray(0, 5).toString(), '%PDF-');
  assert.equal(fixture.calls[0].path, '/orders/print/invoice');
  assert.deepEqual(fixture.calls[0].options, { method: 'POST', body: { ids: [101] } });
  assert.ok(!fixture.calls.some(call => call.path.includes('/orders/create/adhoc')));
  const admin = await fixture.service.invoice(ORDER_ID, { id: 'admin-id', role: 'admin' });
  assert.equal(admin.filename, own.filename);
  assert.deepEqual(admin.document, own.document);
});

test('invoice generation safely handles missing mappings and provider failures', async () => {
  const missing = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: null } });
  await assert.rejects(missing.service.invoice(ORDER_ID, { id: USER_ID, role: 'customer' }),
    error => error.code === 'INVOICE_NOT_AVAILABLE' && error.status === 404);
  assert.equal(missing.calls.length, 0);

  const cases = [
    [shippingError(503, 'SHIPROCKET_AUTH_FAILED', 'private auth failure'), 'INVOICE_PROVIDER_UNAVAILABLE', 503],
    [Object.assign(shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'private rate response'), { upstreamStatus: 429 }), 'INVOICE_RATE_LIMITED', 429],
    [Object.assign(shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'private missing response'), { upstreamStatus: 404 }), 'INVOICE_NOT_AVAILABLE', 404],
    [Object.assign(shippingError(502, 'SHIPROCKET_REQUEST_FAILED', 'private server response'), { upstreamStatus: 500 }), 'INVOICE_UNAVAILABLE', 502],
    [shippingError(504, 'SHIPROCKET_TIMEOUT', 'private network timeout'), 'INVOICE_TIMEOUT', 504]
  ];
  for (const [failure, code, status] of cases) {
    const fixture = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: 101 }, request: async () => { throw failure; } });
    await assert.rejects(fixture.service.invoice(ORDER_ID, { id: USER_ID, role: 'customer' }), error =>
      error.code === code && error.status === status && !error.message.includes('private'));
    assert.equal(fixture.calls.length, 1);
  }

  const malformed = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: 101 }, request: async () => ({ invoice_url: 'http://unsafe.test/invoice.pdf' }) });
  await assert.rejects(malformed.service.invoice(ORDER_ID, { id: USER_ID, role: 'customer' }),
    error => error.code === 'INVOICE_UNAVAILABLE');
  const unavailable = setup({ row: { order_id: ORDER_ID, shiprocket_order_id: 101 }, request: async () => ({ is_invoice_created: false }) });
  await assert.rejects(unavailable.service.invoice(ORDER_ID, { id: USER_ID, role: 'customer' }),
    error => error.code === 'INVOICE_NOT_AVAILABLE' && error.status === 404);
});

test('reconciliation verifies the remote internal order reference before adopting IDs', async () => {
  const fixture = setup({ row: { order_id: ORDER_ID, pending_operation: 'create' }, request: async () => ({ data: {
    id: 101, channel_order_id: 'another-order', shipments: { id: 202 }
  } }) });
  await assert.rejects(fixture.service.reconcile(ORDER_ID, 101), error => error.code === 'SHIPMENT_MISMATCH');
  assert.equal(fixture.getRow().pending_operation, 'create');
  const good = setup({ row: { order_id: ORDER_ID, pending_operation: 'create' }, request: async () => ({ data: {
    id: 101, channel_order_id: ORDER_ID, shipments: { id: 202, awb: null }, status: 'NEW'
  } }) });
  await good.service.reconcile(ORDER_ID, 101);
  assert.equal(good.getRow().pending_operation, null);
  assert.equal(good.getRow().shiprocket_shipment_id, 202);
});
