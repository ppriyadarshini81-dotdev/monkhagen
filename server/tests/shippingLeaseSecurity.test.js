const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../config/db');
const Shipment = require('../models/Shipment');
const { assertFulfillmentSafe, assertShippable } = require('../services/shippingMapping');

const originalConnect = pool.connect;
afterEach(() => { pool.connect = originalConnect; });

function fixture() {
  const leases = new Map(), statements = [];
  let releases = 0;
  pool.connect = async () => ({ release() { releases++; }, query: async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.startsWith('INSERT INTO operation_leases')) {
      if (leases.has(values[0])) return { rows: [] };
      leases.set(values[0], values[1]);
      return { rows: [{ owner_token: values[1] }] };
    }
    if (sql.startsWith('DELETE FROM operation_leases')) {
      if (leases.get(values[0]) === values[1]) leases.delete(values[0]);
    }
    if (sql.startsWith('SELECT 1 FROM operation_leases')) return { rows:
      leases.get(values[0]) === values[1] ? [{ '?column?': 1 }] : [] };
    if (sql.startsWith('UPDATE shipments')) return { rows:
      leases.get(values.at(-2)) === values.at(-1) ? [{ order_id: 'order', awb_code: null }] : [] };
    return { rows: [] };
  } });
  return { leases, statements, get releases() { return releases; } };
}

test('durable shipping lease rejects concurrent owners and releases on success and failure', async () => {
  const f = fixture();
  await Shipment.withLock('order', async client => {
    assert.ok(client.shipmentLease.token);
    await assert.rejects(Shipment.withLock('order', async () => assert.fail('second owner must not run')),
      error => error.code === 'SHIPPING_BUSY');
    await Shipment.patch(client, 'order', { shipping_status: 'pending' });
  });
  assert.equal(f.leases.size, 0);
  await assert.rejects(Shipment.withLock('order', async () => { throw new Error('mock operation failure'); }), /mock operation failure/);
  assert.equal(f.leases.size, 0);
  assert.equal(f.releases, 3);
  assert.ok(f.statements.every(entry => !entry.sql.includes('pg_advisory_lock') && !entry.sql.includes('pg_try_advisory_lock')));
  assert.ok(f.statements.find(entry => entry.sql.includes('WHERE operation_leases.expires_at <= clock_timestamp()')));
});

test('expired/replaced lease cannot persist provider results or release a newer owner', async () => {
  const f = fixture();
  await Shipment.withLock('order', async client => {
    f.leases.set(client.shipmentLease.key, 'new-owner');
    await assert.rejects(Shipment.patch(client, 'order', { shiprocket_order_id: 123 }), error => error.code === 'SHIPPING_BUSY');
    await assert.rejects(Shipment.save(client, 'order', { shiprocket_order_id: 123 }), error => error.code === 'SHIPPING_BUSY');
  });
  assert.equal(f.leases.get('shiprocket:order'), 'new-owner');
  assert.ok(f.statements.some(entry => entry.sql.includes('FOR UPDATE')));
  assert.ok(f.statements.some(entry => entry.sql === 'ROLLBACK'));
  assert.ok(!f.statements.some(entry => entry.sql.includes('UPDATE orders SET awb_number')));
});

test('new shipping intent is fenced by both lease ownership and current payment/hold eligibility', async () => {
  const f = fixture();
  await Shipment.withLock('order', client => Shipment.patch(client, 'order', { pending_operation: 'create' }));
  const intent = f.statements.find(entry => entry.sql.startsWith('UPDATE shipments'));
  assert.ok(intent.sql.includes('o.fulfillment_hold_reason IS NULL'));
  assert.ok(intent.sql.includes("o.payment_status = 'paid'"));
  assert.ok(intent.sql.includes('owner_token ='));
  assert.ok(intent.sql.includes('expires_at > clock_timestamp()'));
});

test('refunded, cancelled and held orders cannot dispatch; safe shipped orders can still retrieve labels', () => {
  const paid = { payment_method: 'razorpay', payment_status: 'paid', order_status: 'confirmed',
    razorpay_order_id: 'order_mock', razorpay_payment_id: 'pay_mock', paid_at: new Date() };
  assert.doesNotThrow(() => assertShippable(paid));
  for (const payment_status of ['pending','failed','refunded','partially_refunded']) {
    assert.throws(() => assertFulfillmentSafe({ ...paid, payment_status }), error => error.code === 'PAYMENT_NOT_VERIFIED');
  }
  assert.throws(() => assertShippable({ ...paid, fulfillment_hold_reason: 'ORDER_REFUND_REVIEW_REQUIRED' }),
    error => error.code === 'ORDER_FULFILLMENT_HELD');
  assert.throws(() => assertFulfillmentSafe({ ...paid, order_status: 'cancelled' }), error => error.code === 'ORDER_NOT_SHIPPABLE');
  assert.doesNotThrow(() => assertFulfillmentSafe({ ...paid, order_status: 'shipped' }));
  assert.throws(() => assertShippable({ ...paid, order_status: 'shipped' }), error => error.code === 'ORDER_NOT_SHIPPABLE');
});
