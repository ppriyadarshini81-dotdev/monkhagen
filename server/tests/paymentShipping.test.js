const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../config/db');
const shipping = require('../services/shippingService');
const razorpayConfig = require('../config/razorpay');
const mail = require('../services/orderConfirmationEmail');

const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const VARIANT_ID = '30000000-0000-4000-8000-000000000001';
process.env.RAZORPAY_KEY_SECRET = 'test-only-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-webhook';
let payment;
razorpayConfig.getRazorpay = () => ({ razorpay: { payments: { fetch: async () => payment } } });
mail.sendOrderConfirmation = async () => false;
// Load after replacing external integrations: these tests cannot create a real payment/shipment/email.
const payments = require('../services/paymentService');
const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalProcess = shipping.processPendingOrder;
afterEach(() => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  shipping.processPendingOrder = originalProcess;
});

function setup({ duplicateEvent = false } = {}) {
  const statements = [];
  const kicks = [];
  const order = { id: ORDER_ID, user_id: USER_ID, razorpay_order_id: 'order_test',
    payment_status: 'pending', total_amount: '1598', cart_id: 'cart_test', order_number: 'MH-TEST' };
  let committed = false;
  let queueInserted = false;
  pool.query = async () => ({ rows: [order] });
  pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (sql === 'COMMIT') committed = true;
      if (sql.includes('INSERT INTO payment_webhook_events')) return { rows: duplicateEvent ? [] : [{ event_id: 'event-test' }] };
      if (sql.includes('SELECT * FROM orders')) return { rows: [order] };
      if (sql.includes('FROM order_items')) return { rows: [{ variant_id: VARIANT_ID, quantity: 1 }] };
      if (sql.includes('UPDATE product_variants')) return { rows: [{ id: VARIANT_ID }] };
      if (sql.includes("payment_status = 'paid'")) return { rows: [{ ...order, payment_status: 'paid', order_status: 'confirmed' }] };
      if (sql.includes('INSERT INTO shipments')) queueInserted = true;
      return { rows: [] };
    }, release() {}
  });
  shipping.processPendingOrder = async id => { kicks.push({ id, committed, queueInserted }); };
  payment = { order_id: 'order_test', status: 'captured', amount: 159800, currency: 'INR' };
  return { statements, kicks };
}

function verification(signature) {
  return {
    localOrderId: ORDER_ID, razorpayPaymentId: 'pay_test', razorpayOrderId: 'order_test',
    razorpaySignature: signature || crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_test|pay_test').digest('hex')
  };
}

function webhook(event, entity = {}) {
  const raw = Buffer.from(JSON.stringify({ event, payload: { payment: { entity: { id: 'pay_test', ...payment, ...entity } } } }));
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  return [raw, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'event-test' }];
}

test('verified capture queues shipping before commit and starts processing only after commit', async () => {
  const fixture = setup();
  const result = await payments.verifyPayment(USER_ID, verification());
  assert.equal(result.paymentStatus, 'paid');
  const insert = fixture.statements.findIndex(sql => sql.includes('INSERT INTO shipments'));
  const paid = fixture.statements.findIndex(sql => sql.includes("payment_status = 'paid'"));
  assert.ok(paid >= 0 && insert > paid && insert < fixture.statements.indexOf('COMMIT'));
  assert.deepEqual(fixture.kicks, [{ id: ORDER_ID, committed: true, queueInserted: true }]);
});

test('frontend success with invalid signature never queues a shipment', async () => {
  const fixture = setup();
  await assert.rejects(payments.verifyPayment(USER_ID, verification('00')), /signature/);
  assert.equal(fixture.kicks.length, 0);
  assert.equal(fixture.statements.length, 0);
});

test('serverless capture persists its queue without launching detached provider work', async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const fixture = setup();
    const result = await payments.verifyPayment(USER_ID, verification());
    assert.equal(result.paymentStatus, 'paid');
    assert.ok(fixture.statements.some(sql => sql.includes('INSERT INTO shipments')));
    assert.deepEqual(fixture.kicks, []);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('authorized but uncaptured payment never queues shipping', async () => {
  const fixture = setup();
  payment.status = 'authorized';
  await assert.rejects(payments.verifyPayment(USER_ID, verification()), /not captured/);
  assert.equal(fixture.kicks.length, 0);
  assert.equal(fixture.statements.length, 0);
});

test('amount mismatch rolls back and never queues a shipment', async () => {
  const fixture = setup();
  payment.amount = 1;
  await assert.rejects(payments.verifyPayment(USER_ID, verification()), /amount/);
  assert.ok(fixture.statements.includes('ROLLBACK'));
  assert.ok(!fixture.statements.some(sql => sql.includes('INSERT INTO shipments')));
  assert.equal(fixture.kicks.length, 0);
});

test('authenticated captured webhook queues shipping after payment commit', async () => {
  const fixture = setup();
  await payments.processWebhook(...webhook('payment.captured'));
  assert.deepEqual(fixture.kicks, [{ id: ORDER_ID, committed: true, queueInserted: true }]);
});

test('failed, duplicate and forged webhooks never trigger a shipment', async () => {
  let fixture = setup();
  await payments.processWebhook(...webhook('payment.failed', { status: 'failed' }));
  assert.equal(fixture.kicks.length, 0);
  fixture = setup({ duplicateEvent: true });
  assert.equal((await payments.processWebhook(...webhook('payment.captured'))).duplicate, true);
  assert.equal(fixture.kicks.length, 0);
  fixture = setup();
  const [raw] = webhook('payment.captured');
  await assert.rejects(payments.processWebhook(raw, { 'x-razorpay-signature': '00' }), /signature/);
  assert.equal(fixture.kicks.length, 0);
});

test('even a signed paid event must contain captured payment details', async () => {
  const fixture = setup();
  await assert.rejects(payments.processWebhook(...webhook('order.paid', { status: 'authorized' })), /captured payment/);
  assert.equal(fixture.kicks.length, 0);
});
