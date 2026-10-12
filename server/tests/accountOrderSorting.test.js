const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../config/db');
const { getOrders } = require('../controllers/accountController');

test('customer order sorting and date ranges apply before pagination and include whole India calendar days', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID, order_number TEXT, created_at TIMESTAMPTZ,
      order_type TEXT DEFAULT 'normal', payment_method TEXT DEFAULT 'cod', payment_status TEXT DEFAULT 'paid',
      razorpay_payment_id TEXT, order_status TEXT DEFAULT 'delivered');
    CREATE TABLE shipments (order_id UUID, awb_code TEXT, courier_name TEXT, tracking_url TEXT,
      shipping_status TEXT, tracking_status TEXT, pickup_status TEXT, estimated_delivery TIMESTAMPTZ, shiprocket_order_id BIGINT);
    CREATE TABLE order_cancellations (order_id UUID, status TEXT, reason TEXT, cancelled_at TIMESTAMPTZ, refund_status TEXT);
    CREATE TABLE order_items (id UUID, order_id UUID, product_id UUID, created_at TIMESTAMPTZ);
    CREATE TABLE product_images (product_id UUID, image_url TEXT, is_primary BOOLEAN, display_order INTEGER, created_at TIMESTAMPTZ);
    CREATE TABLE order_addresses (order_id UUID);
    INSERT INTO orders (id, user_id, order_number, created_at, order_status) VALUES
      ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'oldest', '2026-10-01', 'processing'),
      ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'middle-a', '2026-10-05', 'delivered'),
      ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'middle-b', '2026-10-05', 'delivered'),
      ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'newest', '2026-10-11', 'cancelled'),
      ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', 'other-customer', '2026-10-12', 'delivered'),
      ('10000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'after-sales', '2026-10-12', 'delivered'),
      ('10000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'unpaid-online', '2026-10-12', 'confirmed');
    UPDATE orders SET order_type = 'replacement' WHERE order_number = 'after-sales';
    UPDATE orders SET payment_method = 'razorpay', payment_status = 'pending' WHERE order_number = 'unpaid-online';
  `);
  const query = t.mock.method(pool, 'query', (sql, values) => db.query(sql, values));
  async function list(params = {}) {
    let status = 200, body;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
    await getOrders({ user: { id: '20000000-0000-4000-8000-000000000001' },
      query: { limit: '2', offset: '0', ...params } }, res, error => { throw error; });
    return { status, body };
  }
  const names = response => response.body.map(order => order.orderNumber);
  assert.deepEqual(names(await list()), ['newest', 'middle-b']);
  assert.deepEqual(names(await list({ sort: 'newest', offset: '2' })), ['middle-a', 'oldest']);
  assert.deepEqual(names(await list({ sort: 'oldest' })), ['oldest', 'middle-a']);
  assert.deepEqual(names(await list({ sort: 'oldest', offset: '2' })), ['middle-b', 'newest']);
  assert.deepEqual(names(await list({ sort: 'oldest', status: 'delivered' })), ['middle-a', 'middle-b']);
  assert.deepEqual(names(await list({ sort: 'newest', status: 'cancelled' })), ['newest']);
  const calls = query.mock.callCount();
  const invalid = await list({ sort: 'ASC; DROP TABLE orders' });
  assert.equal(invalid.status, 400);
  assert.equal(query.mock.callCount(), calls);
  assert.equal((await list({ status: 'invalid' })).status, 400);
  await db.exec(`INSERT INTO orders (id, user_id, order_number, created_at) VALUES
    ('10000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', 'before-range', '2026-10-05T18:29:59.999Z'),
    ('10000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', 'start-of-day', '2026-10-05T18:30:00Z'),
    ('10000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'end-of-day', '2026-10-06T18:29:59.999Z'),
    ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'after-range', '2026-10-06T18:30:00Z');`);
  const range = { dateFrom: '2026-10-06', dateTo: '2026-10-06', sort: 'oldest', status: 'delivered' };
  assert.deepEqual(names(await list(range)), ['start-of-day', 'end-of-day']);
  assert.deepEqual(names(await list({ ...range, sort: 'newest' })), ['end-of-day', 'start-of-day']);
  assert.deepEqual(names(await list({ ...range, limit: '1' })), ['start-of-day']);
  assert.deepEqual(names(await list({ ...range, limit: '1', offset: '1' })), ['end-of-day']);
  assert.deepEqual(names(await list({ dateFrom: '2026-10-11' })), ['newest']);
  assert.deepEqual(names(await list({ dateTo: '2026-10-05', sort: 'oldest', limit: '100' })),
    ['oldest', 'middle-a', 'middle-b', 'before-range']);
  const rangeCalls = query.mock.callCount();
  assert.equal((await list({ dateFrom: '2026-10-11', dateTo: '2026-10-01' })).status, 400);
  for (const invalidDate of ['2026-02-30', '2026-13-01', '0000-01-01', '2026-10-06T00:00:00Z', ['2026-10-06'], {}]) {
    await assert.rejects(list({ dateFrom: invalidDate }), { status: 400 });
    await assert.rejects(list({ dateTo: invalidDate }), { status: 400 });
  }
  assert.equal(query.mock.callCount(), rangeCalls);
});
