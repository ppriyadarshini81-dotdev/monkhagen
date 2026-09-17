const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn } = require('../services/returnService');
const ORDER = '10000000-0000-4000-8000-000000000001';
const ITEM = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const input = (items = [{ orderItemId: ITEM, quantity: 1 }]) => ({ orderId: ORDER, reason: 'Wrong size', items });
function database({ missingOrder = false, missingItem = false, existing = false, status = 'delivered', deliveredAt = new Date() } = {}) {
  const queries = [];
  let released = false;
  return { queries, get released() { return released; }, connect: async () => ({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM orders')) return { rows: missingOrder ? [] : [{ order_status: status, delivered_at: deliveredAt }] };
      if (sql.includes('SELECT id FROM return_requests')) return { rows: existing ? [{ id: 'existing' }] : [] };
      if (sql.includes('SELECT id, quantity FROM order_items')) return { rows: missingItem ? [] : [{ id: ITEM, quantity: 2 }] };
      if (sql.startsWith('INSERT INTO return_requests')) return { rows: [{ id: 'return-id' }] };
      return { rows: [] };
    }, release: () => { released = true; }
  }) };
}
test('returns validate order ownership and each purchased item inside one transaction', async () => {
  const db = database();
  const result = await createReturn('customer-id', input(), db);
  assert.equal(result.id, 'return-id');
  assert.deepEqual(result.items, [{ orderItemId: ITEM, quantity: 1, reason: null }]);
  assert.deepEqual(db.queries[1].params, [ORDER, 'customer-id']);
  assert.match(db.queries[1].sql, /user_id = \$2 FOR UPDATE/);
  const itemCheck = db.queries.find(row => row.sql.includes('FROM order_items'));
  assert.match(itemCheck.sql, /order_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(itemCheck.params, [ORDER, [ITEM]]);
  assert.equal(db.queries.at(-1).sql, 'COMMIT');
  assert.equal(db.released, true);
});
test('foreign order and foreign item IDs never create return records', async () => {
  for (const options of [{ missingOrder: true }, { missingItem: true }]) {
    const db = database(options);
    await assert.rejects(createReturn('customer-id', input([{ orderItemId: OTHER, quantity: 1 }]), db),
      error => [400,404].includes(error.status));
    assert.equal(db.queries.some(row => row.sql.startsWith('INSERT')), false);
    assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
  }
});
test('over-return quantities, duplicate IDs, noninteger and negative quantities are rejected', async () => {
  for (const quantity of [0,-1,1.5,'1',101]) {
    const db = database();
    await assert.rejects(createReturn('customer-id', input([{ orderItemId: ITEM, quantity }]), db), error => error.status === 400);
    assert.equal(db.queries.length, 0);
  }
  const db = database();
  await assert.rejects(createReturn('customer-id', input([{ orderItemId: ITEM, quantity: 3 }]), db), /purchased quantities/);
  assert.equal(db.queries.some(row => row.sql.startsWith('INSERT')), false);
  await assert.rejects(createReturn('customer-id', input([{ orderItemId: ITEM, quantity: 1 }, { orderItemId: ITEM, quantity: 1 }]), database()), /unique item ID/);
});
test('undelivered, stale, future and duplicate returns fail before insertion', async () => {
  for (const options of [{ status: 'confirmed' }, { deliveredAt: new Date(Date.now() - 8 * 86400000) },
    { deliveredAt: 'invalid' }, { deliveredAt: new Date(Date.now() + 86400000) }, { existing: true }]) {
    const db = database(options);
    await assert.rejects(createReturn('customer-id', input(), db));
    assert.equal(db.queries.some(row => row.sql.startsWith('INSERT')), false);
    assert.equal(db.released, true);
  }
});
test('UUID and string validation rejects malformed return bodies without querying the database', async () => {
  for (const body of [{ ...input(), orderId: 'not-uuid' }, { ...input(), reason: {} }, { ...input(), comments: {} },
    { ...input(), items: [null] }, { ...input(), items: [{ orderItemId: ITEM, quantity: 1, reason: {} }] }]) {
    const db = database();
    await assert.rejects(createReturn('customer-id', body, db), error => error.status === 400);
    assert.equal(db.queries.length, 0);
  }
});
