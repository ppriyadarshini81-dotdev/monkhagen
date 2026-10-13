const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../config/db');
const gateway = require('../config/razorpay');
const mail = require('../services/orderConfirmationEmail');
const shipping = require('../services/shippingService');
const inventory = require('../services/inventoryService');
const transactionalEmail = require('../services/transactionalEmailService');
process.env.RAZORPAY_KEY_SECRET = crypto.randomBytes(32).toString('hex');
process.env.RAZORPAY_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
let remoteCreates, providerPayment, remoteCreateError;
const remoteAmounts=[];
gateway.getRazorpay = () => ({ keyId: 'test-key', razorpay: {
  orders: { create: async input => {if(remoteCreateError)throw remoteCreateError;remoteAmounts.push(input.amount);return { id: `order_mock_${++remoteCreates}` };} },
  payments: { fetch: async () => providerPayment }
} });
mail.sendOrderConfirmation = async () => false;
const payments = require('../services/paymentService');
const Order = require('../models/Order');
const originals = { query: pool.query, connect: pool.connect, process: shipping.processPendingOrder,
  refundCompleted: transactionalEmail.refundCompleted };
afterEach(() => { pool.query = originals.query; pool.connect = originals.connect; shipping.processPendingOrder = originals.process;
  transactionalEmail.refundCompleted = originals.refundCompleted; remoteCreateError = null; });
const USER = '20000000-0000-4000-8000-000000000001';
const ADDRESS = '30000000-0000-4000-8000-000000000001';
const VARIANT = '40000000-0000-4000-8000-000000000001';
const PRODUCT = '50000000-0000-4000-8000-000000000001';
const INVENTORY = '60000000-0000-4000-8000-000000000001';
const SIZE = '70000000-0000-4000-8000-000000000001';
const attempt = () => ({ addressId: ADDRESS, checkoutToken: crypto.randomUUID() });

// Transaction/row-lock double with rollback/savepoint snapshots. All gateway,
// shipping, mail and SQL I/O is replaced; no production business data is written.
function setup({ stock = 3, quantity = 1, priorOrders = [], returnRequest = null } = {}) {
  let state = { stock, quantity, orders: structuredClone(priorOrders), items: [], refunds: new Map(), events: new Set(),
    converted: new Set(), shipments: new Set(), returnRequest: returnRequest ? structuredClone(returnRequest) : null };
  const statements = [], kicks = [];
  remoteCreates = 0;
  let queue = Promise.resolve();
  pool.connect = async () => {
    let snapshot, savepoint, unlock, customer;
    return { release() {}, query: async (statement, params = []) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      statements.push({ sql, params });
      if (sql === 'BEGIN') {
        const preceding = queue;
        queue = new Promise(resolve => { unlock = resolve; });
        await preceding; snapshot = structuredClone(state);
      }
      if (sql === 'COMMIT') { unlock?.(); unlock = null; }
      if (sql === 'ROLLBACK') { state = snapshot; unlock?.(); unlock = null; }
      if (sql.startsWith('SAVEPOINT')) savepoint = structuredClone(state);
      if (sql.startsWith('ROLLBACK TO')) state = savepoint;
      if (sql.startsWith('SELECT id FROM carts')) {
        customer = params[0]; return { rows: state.converted.has(customer) ? [] : [{ id: `cart:${customer}` }] };
      }
      if (sql.startsWith('SELECT * FROM customer_addresses')) return { rows: [{ full_name: 'Test Customer', phone: '9876543210', email: 'buyer@example.test',
        address_line1: '10 Test Road', city: 'Pune', state: 'Maharashtra', postal_code: '411001', country: 'India' }] };
      if (sql.startsWith('SELECT ci.product_id')) return { rows: [{ product_id: PRODUCT, variant_id: VARIANT,
        product_name: 'Test product', quantity: state.quantity, product_active: true, variant_active: true,
        category_active: true, inventory_id: INVENTORY, inventory_configured: true, size_active: true,
        stock: state.stock, unit_price: '100.00', size: 'M', color: 'Black' }] };
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ has_order: state.orders.some(row =>
        row.user_id === params[0] && (row.payment_method === 'cod' ||
          ['paid','refunded','partially_refunded'].includes(row.payment_status))) }] };
      if (sql.startsWith('SELECT * FROM orders')) {
        let records = state.orders;
        if (sql.includes('inventory_reservation_expires_at <= NOW()')) records = records.filter(row =>
          row.inventory_reserved_at && !row.inventory_released_at && !row.inventory_deducted_at &&
          ['pending','failed'].includes(row.payment_status) && new Date(row.inventory_reservation_expires_at).getTime() <= Date.now());
        else if (sql.includes('checkout_token = $1')) records = records.filter(row => row.checkout_token === params[0] && row.user_id === params[1]);
        else if (sql.includes('checkout_token = $2')) records = records.filter(row => row.checkout_token === params[1] && row.user_id === params[0] && row.payment_method === 'cod');
        else if (sql.includes('razorpay_payment_id = $1')) records = records.filter(row => row.razorpay_payment_id === params[0]);
        else if (sql.includes('razorpay_order_id = $1')) records = records.filter(row => row.razorpay_order_id === params[0] && (!sql.includes("payment_status = 'pending'") || row.payment_status === 'pending'));
        return { rows: records.map(row => ({ ...row })) };
      }
      if (sql.startsWith('SELECT id FROM orders WHERE cart_id')) return { rows: state.orders.filter(row =>
        row.cart_id === params[0] && row.payment_status === 'pending' && row.inventory_reserved_at && !row.inventory_released_at) };
      if (sql.startsWith('UPDATE product_size_details')) {
        const before = state.stock;
        if (sql.includes('stock_quantity = stock_quantity -')) {
          if (state.stock < params[0]) return { rows: [] };
          state.stock -= params[0];
        } else state.stock += params[0];
        return { rows: [{ id: INVENTORY, product_id: PRODUCT, size_id: SIZE,
          quantity_before: before, quantity_after: state.stock }] };
      }
      if (sql.startsWith('INSERT INTO inventory_movements')) return { rows: [{ id: crypto.randomUUID() }] };
      if (sql.startsWith('INSERT INTO orders')) {
        const prepaid = sql.includes("'razorpay'");
        const row = { id: crypto.randomUUID(), user_id: params[0], cart_id: params[1], checkout_token: params[2],
          order_number: params[3], total_amount: params[6], subtotal: params[4],
          discount_amount: prepaid ? params[5] : '0', shipping_amount: prepaid ? '0' : params[5],
          payment_method: prepaid ? 'razorpay' : 'cod', payment_status: 'pending', order_status: prepaid ? 'placed' : 'confirmed',
          inventory_reserved_at: prepaid ? new Date() : null, inventory_reservation_expires_at: new Date(Date.now() + 900000),
          inventory_deducted_at: prepaid ? null : new Date(), fulfillment_hold_reason: null, refunded_amount: '0' };
        state.orders.push(row); return { rows: [{ ...row }] };
      }
      if (sql.startsWith('INSERT INTO order_items')) {
        state.items.push({ order_id: params[0], product_id: params[1], variant_id: params[2], product_name: params[3],
          quantity: params[7], unit_price: params[8], total_price: params[9] });
      }
      if (sql.startsWith('SELECT psd.id AS inventory_id')) return { rows: state.items.some(row => row.order_id === params[0])
        ? [{ inventory_id: INVENTORY, product_id: PRODUCT, size_id: SIZE, size: 'M',
          quantity: state.items.filter(row => row.order_id === params[0]).reduce((sum, row) => sum + row.quantity, 0) }]
        : [] };
      if (sql.startsWith('SELECT variant_id')) return { rows: state.items.filter(row => row.order_id === params[0]) };
      if (sql.startsWith('SELECT * FROM order_items')) return { rows: state.items.filter(row => row.order_id === params[0]) };
      if (sql.startsWith('SELECT * FROM order_addresses')) return { rows: [] };
      if (sql.startsWith('UPDATE orders')) {
        if (sql.includes('SET razorpay_order_id')) state.orders.find(row => row.id === params[1]).razorpay_order_id = params[0];
        else if (sql.includes('inventory_released_at = NOW()')) state.orders.find(row => row.id === params[0]).inventory_released_at = new Date();
        else if (sql.includes('SET razorpay_payment_id')) {
          const row = state.orders.find(row => row.id === params[2]);
          Object.assign(row, { razorpay_payment_id: params[0], payment_status: 'paid', paid_at: new Date(),
            fulfillment_hold_reason: params[3], order_status: ['cancelled','returned'].includes(row.order_status)
              ? row.order_status : params[3] ? 'processing' : 'confirmed',
            inventory_deducted_at: params[4] ? new Date() : row.inventory_deducted_at });
          return { rows: [{ ...row }] };
        } else if (sql.includes('SET refunded_amount')) {
          Object.assign(state.orders.find(row => row.id === params[2]), {
            refunded_amount: params[0], payment_status: params[1], fulfillment_hold_reason: 'ORDER_REFUND_REVIEW_REQUIRED' });
        } else if (sql.includes("payment_status = 'failed'")) state.orders.find(row => row.id === params[0]).payment_status = 'failed';
      }
      if (sql.startsWith('UPDATE carts')) state.converted.add(params[1]);
      if (sql.startsWith('INSERT INTO shipments')) state.shipments.add(params[0]);
      if (sql.startsWith('INSERT INTO payment_webhook_events')) {
        if (state.events.has(params[0])) return { rows: [] };
        state.events.add(params[0]); return { rows: [{ event_id: params[0] }] };
      }
      if (sql.startsWith('INSERT INTO payment_refunds') && !state.refunds.has(params[0])) {
        state.refunds.set(params[0], { order_id: params[1], payment_id: params[2], amount: Number(params[3]) });
      }
      if (sql.startsWith('SELECT order_id, payment_id, amount FROM payment_refunds')) return { rows:
        state.refunds.has(params[0]) ? [state.refunds.get(params[0])] : [] };
      if (sql.startsWith('SELECT COALESCE(SUM(amount)')) return { rows: [{ amount:
        [...state.refunds.values()].filter(row => row.order_id === params[0]).reduce((sum, row) => sum + row.amount, 0) }] };
      if (sql.startsWith('SELECT * FROM return_requests')) return { rows: state.returnRequest ? [{ ...state.returnRequest }] : [] };
      if (sql.startsWith('UPDATE return_requests SET razorpay_refund_id')) {
        Object.assign(state.returnRequest, { razorpay_refund_id: params[0], status: 'refunded', refund_status: 'refunded' });
      }
      return { rows: [] };
    } };
  };
  pool.query = async (sql, params) => {
    if (sql.includes('SELECT id, user_id, razorpay_order_id')) return { rows: state.orders.filter(row => row.id === params[0] && row.user_id === params[1]) };
    if (sql.includes('FROM order_items')) return { rows: state.items.filter(row => row.order_id === params[0]) };
    return { rows: [] };
  };
  shipping.processPendingOrder = async id => { kicks.push(id); };
  return { get state() { return state; }, statements, kicks };
}
function captured(order) {
  providerPayment = { id: 'pay_mock', order_id: order.razorpay_order_id, status: 'captured',
    amount: Math.round(Number(order.total_amount) * 100), currency: 'INR' };
  return { localOrderId: order.id, razorpayPaymentId: providerPayment.id, razorpayOrderId: order.razorpay_order_id,
    razorpaySignature: crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${order.razorpay_order_id}|pay_mock`).digest('hex') };
}
function event(name, payload, id = crypto.randomUUID()) {
  const raw = Buffer.from(JSON.stringify({ event: name, payload }));
  return [raw, { 'x-razorpay-event-id': id, 'x-razorpay-signature': crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex') }];
}

test('prepaid checkout reserves stock once and same-token retries reuse the server-priced order', async () => {
  const fixture = setup({ stock: 2 });
  const input = attempt();
  const [first, second] = await Promise.all([payments.createPaymentOrder(USER, input), payments.createPaymentOrder(USER, input)]);
  assert.equal(first.localOrderId, second.localOrderId);
  assert.equal(first.amount, 9000);
  assert.equal(fixture.state.orders[0].subtotal, '100.00');
  assert.equal(fixture.state.orders[0].discount_amount, '10.00');
  assert.equal(fixture.state.orders[0].total_amount, '90.00');
  assert.equal(fixture.state.stock, 1);
  assert.equal(remoteCreates, 1);
  assert.equal(fixture.state.orders.length, 1);
  assert.equal(fixture.state.shipments.size, 0);
});

test('Razorpay rate limiting returns a safe retry message and rolls back reserved inventory', async () => {
  const fixture = setup({ stock: 2 });
  const input = attempt();
  remoteCreateError = { statusCode: 429, error: { description: 'Private provider response' } };
  await assert.rejects(payments.createPaymentOrder(USER, input), error => error.status === 429 &&
    error.message === 'Online payment is busy. Please wait a moment and try again.');
  assert.equal(fixture.state.stock, 2);
  assert.equal(fixture.state.orders.length, 0);
  assert.equal(fixture.state.items.length, 0);
  assert.equal(remoteCreates, 0);
  remoteCreateError = null;
  await payments.createPaymentOrder(USER, input);
  assert.equal(fixture.state.orders.length, 1);
  assert.equal(fixture.state.stock, 1);
});
test('first prepaid offer is not applied after the customer has already placed a COD order', async () => {
  const fixture = setup({ priorOrders: [{ id: crypto.randomUUID(), user_id: USER, payment_method: 'cod',
    payment_status: 'pending', order_status: 'confirmed' }] });
  const payment = await payments.createPaymentOrder(USER, attempt());
  assert.equal(payment.amount, 10000);
  const order = fixture.state.orders.at(-1);
  assert.equal(order.discount_amount, '0.00');
  assert.equal(order.total_amount, '100.00');
});
test('concurrent customers cannot buy the last stock twice or create an unbacked payment order', async () => {
  const fixture = setup({ stock: 1 });
  const results = await Promise.allSettled([payments.createPaymentOrder(USER, attempt()), payments.createPaymentOrder(crypto.randomUUID(), attempt())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(fixture.state.stock, 0);
  assert.equal(remoteCreates, 1);
});
test('same cart cannot reserve multiple prepaid orders using different tokens', async () => {
  const fixture = setup();
  await payments.createPaymentOrder(USER, attempt());
  await assert.rejects(payments.createPaymentOrder(USER, attempt()), /already pending/);
  assert.equal(fixture.state.stock, 2);
  assert.equal(remoteCreates, 1);
});
test('capture consumes a reservation without a second deduction; duplicate verification cannot repeat processing', async () => {
  const fixture = setup({ stock: 1 });
  await payments.createPaymentOrder(USER, attempt());
  const verify = captured(fixture.state.orders[0]);
  assert.equal((await payments.verifyPayment(USER, verify)).paymentStatus, 'paid');
  assert.equal((await payments.verifyPayment(USER, verify)).paymentStatus, 'paid');
  assert.equal(fixture.state.stock, 0);
  assert.equal(fixture.state.shipments.size, 1);
  assert.ok(fixture.state.orders[0].inventory_deducted_at);
});
test('COD rejects an out-of-stock cart without creating an order or Razorpay order', async () => {
  const fixture = setup({ stock: 0 });
  await assert.rejects(Order.createCod(USER, attempt()), /stock/i);
  assert.equal(fixture.state.orders.length, 0);
  assert.equal(fixture.state.shipments.size, 0);
  assert.equal(remoteCreates, 0);
});
test('expired and failed reservations restore stock once, and expired attempts cannot be reused', async () => {
  const fixture = setup({ stock: 2 });
  const input = attempt();
  await payments.createPaymentOrder(USER, input);
  fixture.state.orders[0].inventory_reservation_expires_at = new Date(Date.now() - 1000);
  const client = await pool.connect();
  await client.query('BEGIN');
  await inventory.releaseExpiredReservations(client);
  await inventory.releaseExpiredReservations(client);
  await client.query('COMMIT');
  assert.equal(fixture.state.stock, 2);
  await assert.rejects(payments.createPaymentOrder(USER, input), /unavailable/);
  await payments.createPaymentOrder(USER, attempt());
  const pending = fixture.state.orders.at(-1);
  const failed = event('payment.failed', { payment: { entity: { order_id: pending.razorpay_order_id, status: 'failed' } } });
  await payments.processWebhook(...failed);
  await payments.processWebhook(...failed);
  assert.equal(fixture.state.stock, 2);
});
test('late captured payment with no remaining stock stays paid with a fulfillment hold instead of financial rollback', async () => {
  const fixture = setup({ stock: 1 });
  await payments.createPaymentOrder(USER, attempt());
  fixture.state.orders[0].inventory_released_at = new Date();
  const result = await payments.verifyPayment(USER, captured(fixture.state.orders[0]));
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.fulfillmentHoldReason, 'ORDER_INVENTORY_REVIEW_REQUIRED');
  assert.equal(fixture.state.orders[0].payment_status, 'paid');
  assert.equal(fixture.state.orders[0].inventory_deducted_at, null);
  assert.equal(fixture.state.shipments.size, 0);
  assert.equal(fixture.kicks.length, 0);
});
test('COD is server-priced, allocates stock and converts its cart atomically; duplicate token reuses the order', async () => {
  const fixture = setup({ stock: 1 });
  const input = attempt();
  const [first, second] = await Promise.all([Order.createCod(USER, input), Order.createCod(USER, input)]);
  assert.equal(first.id, second.id);
  assert.equal(first.subtotal, 100);
  assert.equal(first.shippingAmount, 100);
  assert.equal(first.totalAmount, 200);
  assert.equal(fixture.state.stock, 0);
  assert.equal(fixture.state.orders.length, 1);
  assert.equal(fixture.state.converted.has(USER), true);
  assert.equal(fixture.state.shipments.size, 1);
  assert.ok(fixture.state.orders[0].inventory_deducted_at);
  const snapshotQuery = fixture.statements.find(({ sql }) => sql.startsWith('SELECT ci.product_id'))?.sql || '';
  assert.match(snapshotQuery, /FOR UPDATE OF ci, p, pv$/);
  assert.doesNotMatch(snapshotQuery, /FOR UPDATE OF[^\n]*psd/);
  assert.equal(remoteCreates, 0);
});
test('legacy COD retries without tokens cannot process a converted cart again', async () => {
  const fixture = setup();
  await Order.createCod(USER, { addressId: ADDRESS });
  await assert.rejects(Order.createCod(USER, { addressId: ADDRESS }), /empty/);
  assert.equal(fixture.state.orders.length, 1);
});
test('processed partial/full refunds deduplicate refund IDs and capture replay cannot reset refunded state', async () => {
  const fixture = setup({ stock: 1 });
  await payments.createPaymentOrder(USER, attempt());
  const verify = captured(fixture.state.orders[0]);
  await payments.verifyPayment(USER, verify);
  const refund = { id: 'rfnd_mock_1', payment_id: 'pay_mock', amount: 4000, currency: 'INR', status: 'processed' };
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }));
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }));
  assert.equal(fixture.state.orders[0].refunded_amount, '40.00');
  assert.equal(fixture.state.orders[0].payment_status, 'partially_refunded');
  assert.equal(fixture.state.refunds.size, 1);
  await payments.processWebhook(...event('refund.processed', { refund: { entity: { ...refund, id: 'rfnd_mock_2', amount: 5000 } } }));
  assert.equal(fixture.state.orders[0].refunded_amount, '90.00');
  const kicks = fixture.kicks.length;
  assert.equal((await payments.verifyPayment(USER, verify)).paymentStatus, 'refunded');
  assert.equal(fixture.kicks.length, kicks);
  assert.equal(fixture.state.stock, 0);
});

test('signed refund.processed completes the linked return and queues the completed-refund notification once', async () => {
  const fixture = setup({ stock: 1 });
  await payments.createPaymentOrder(USER, attempt());
  const order = fixture.state.orders[0];
  await payments.verifyPayment(USER, captured(order));
  const linkedReturn = { id: crypto.randomUUID(), order_id: order.id, refund_amount: order.total_amount,
    razorpay_refund_id: 'rfnd_linked', status: 'refund_initiated', refund_status: 'processing' };
  fixture.state.returnRequest = linkedReturn;
  const notifications = [];
  transactionalEmail.refundCompleted = async (returnId, refundId) => notifications.push({ returnId, refundId });
  const refund = { id: 'rfnd_linked', payment_id: 'pay_mock', amount: Math.round(Number(order.total_amount) * 100),
    currency: 'INR', status: 'processed', notes: { return_request_id: linkedReturn.id } };
  const webhookId = crypto.randomUUID();
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }, webhookId));
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }, webhookId));
  assert.equal(fixture.state.returnRequest.status, 'refunded');
  assert.deepEqual(notifications, [{ returnId: linkedReturn.id, refundId: refund.id }]);
});
test('signed invalid or excessive refunds roll back without changing paid financial state', async () => {
  const fixture = setup();
  await payments.createPaymentOrder(USER, attempt());
  await payments.verifyPayment(USER, captured(fixture.state.orders[0]));
  for (const amount of [-1,0,20000]) {
    await assert.rejects(payments.processWebhook(...event('refund.processed', { refund: { entity:
      { id: 'rfnd_bad', payment_id: 'pay_mock', amount, currency: 'INR', status: 'processed' } } })));
    assert.equal(fixture.state.orders[0].payment_status, 'paid');
    assert.equal(fixture.state.refunds.size, 0);
  }
});

test('refund delivered before capture establishes financial state and holds shipment, including refund-only payloads', async () => {
  const fixture = setup({ stock: 1 });
  await payments.createPaymentOrder(USER, attempt());
  captured(fixture.state.orders[0]);
  providerPayment = { ...providerPayment, status: 'refunded', amount_refunded: 9000 };
  const refund = { id: 'rfnd_early', payment_id: 'pay_mock', amount: 9000, currency: 'INR', status: 'processed' };
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }));
  assert.equal(fixture.state.orders[0].payment_status, 'refunded');
  assert.equal(fixture.state.orders[0].refunded_amount, '90.00');
  assert.equal(fixture.state.orders[0].fulfillment_hold_reason, 'ORDER_REFUND_REVIEW_REQUIRED');
  assert.equal(fixture.kicks.length, 0);
  await payments.processWebhook(...event('payment.captured', { payment: { entity: { ...providerPayment, status: 'captured' } } }));
  assert.equal(fixture.state.orders[0].payment_status, 'refunded');
  assert.equal(fixture.kicks.length, 0);
  assert.equal(fixture.state.stock, 0);
});

test('reusing a refund ID with different details is rejected rather than silently altering the ledger', async () => {
  const fixture = setup();
  await payments.createPaymentOrder(USER, attempt());
  await payments.verifyPayment(USER, captured(fixture.state.orders[0]));
  const refund = { id: 'rfnd_unique', payment_id: 'pay_mock', amount: 4000, currency: 'INR', status: 'processed' };
  await payments.processWebhook(...event('refund.processed', { refund: { entity: refund } }));
  await assert.rejects(payments.processWebhook(...event('refund.processed', { refund: { entity: { ...refund, amount: 5000 } } })), /different refund details/);
  assert.equal(fixture.state.orders[0].refunded_amount, '40.00');
});

test('checkout rejects negative, fractional, zero and excessive quantities before creating provider orders', async () => {
  for (const quantity of [-1,0,1.5,101]) {
    const fixture = setup({ stock: 1000, quantity });
    await assert.rejects(payments.createPaymentOrder(USER, attempt()), /quantity/);
    assert.equal(fixture.state.stock, 1000);
    assert.equal(remoteCreates, 0);
  }
});

test('capture following local cancellation stays financially paid without restarting shipment', async () => {
  const fixture = setup();
  await payments.createPaymentOrder(USER, attempt());
  fixture.state.orders[0].order_status = 'cancelled';
  const result = await payments.verifyPayment(USER, captured(fixture.state.orders[0]));
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.orderStatus, 'cancelled');
  assert.equal(result.fulfillmentHoldReason, 'ORDER_CANCELLED_CAPTURE_REVIEW');
  assert.equal(fixture.state.stock, 3);
  assert.equal(fixture.state.shipments.size, 0);
  assert.equal(fixture.kicks.length, 0);
});
