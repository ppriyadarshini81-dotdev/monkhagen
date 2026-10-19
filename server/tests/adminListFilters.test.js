const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const filters = require('../services/adminListFilters');

test('validates filter input and binds search as data', () => {
  for (const query of [{ status: 'invalid' }, { fulfillment: '__proto__' }, { from: '2026-02-30' },
    { from: '2026-10-20', to: '2026-10-01' }, { sort: 'DROP TABLE orders' }, { search: ['bad'] }]) {
    assert.throws(() => filters(query), error => error.status === 400);
  }
  const result = filters({ search: "' OR TRUE --" }, { values: [11, 0] });
  assert.ok(!result.clause.includes("' OR TRUE --"));
  assert.deepEqual(result.values, [11, 0, "%' OR TRUE --%"]);
});

test('filters the full order and return lists before pagination, including old orders and linked products', async () => {
  const db = new PGlite();
  try {
    await db.exec(`SET TIME ZONE 'UTC'; CREATE TABLE users(id uuid, name text, email text, phone text);
      CREATE TABLE orders(id uuid, order_number text, user_id uuid, order_type text DEFAULT 'normal',
        payment_method text DEFAULT 'razorpay', payment_status text DEFAULT 'paid', order_status text DEFAULT 'confirmed',
        fulfillment_hold_reason text, awb_number text, source_order_id uuid, return_request_id uuid, created_at timestamptz DEFAULT '2026-10-01');
      CREATE TABLE shipments(order_id uuid, last_error_code text, tracking_status text, shipping_status text, awb_code text);
      CREATE TABLE order_addresses(order_id uuid, full_name text, phone text, email text);
      CREATE TABLE order_items(id uuid, order_id uuid, product_name text);
      CREATE TABLE return_requests(id uuid, order_id uuid, user_id uuid, return_number text, request_type text,
        status text, refund_status text, created_at timestamptz);
      CREATE TABLE return_items(return_request_id uuid, order_item_id uuid);`);
    const customer = randomUUID(), old = randomUUID(), item = randomUUID(), request = randomUUID();
    await db.query('INSERT INTO users VALUES ($1, $2, $3, $4)', [customer, 'Older Customer', 'older@example.com', '9876543210']);
    for (let i = 0; i < 120; i++) await db.query('INSERT INTO orders (id,order_number) VALUES ($1,$2)', [randomUUID(), `MH-NEW-${i}`]);
    await db.query(`INSERT INTO orders(id,order_number,user_id,created_at) VALUES ($1,'MH-OLD',$2,'2025-01-01T12:30:00Z')`, [old,customer]);
    await db.query(`INSERT INTO order_items VALUES ($1,$2,'Cream Tee')`, [item,old]);
    await db.query(`INSERT INTO shipments(order_id,tracking_status,awb_code) VALUES ($1,'DELIVERED','AWB-123')`, [old]);
    await db.query(`INSERT INTO return_requests VALUES ($1,$2,$3,'R-OLD','replacement','received','pending','2026-10-10T21:00:00Z')`, [request,old,customer]);
    await db.query('INSERT INTO return_items VALUES ($1,$2)', [request,item]);
    const orders = async (query, limit = 10, offset = 0) => {
      const f = filters(query, { values: [limit, offset] });
      return (await db.query(`SELECT o.id FROM orders o LEFT JOIN shipments s ON s.order_id=o.id
        WHERE o.order_type='normal' ${f.clause} ORDER BY ${f.order} LIMIT $1 OFFSET $2`, f.values)).rows;
    };
    assert.ok(!(await orders({},100)).some(row => row.id === old));
    assert.deepEqual(await orders({ search: 'older@example.com', paymentStatus:'paid', fulfillment:'delivered', from:'2025-01-01', to:'2025-01-01' }), [{id:old}]);
    assert.equal((await orders({ fulfillment:'shipped', search:'MH-OLD' })).length,0);
    assert.deepEqual(await orders({ search:'Cream Tee', sort:'oldest' }),[{id:old}]);
    const first = await orders({},10,0), second = await orders({},10,10);
    assert.equal(first.length,10); assert.equal(second.length,10);
    assert.ok(!first.some(row => second.some(other => other.id===row.id)));
    const f = filters({ search:'Cream Tee', requestType:'replacement', status:'received', refundStatus:'pending', from:'2026-10-11',to:'2026-10-11' }, {returns:true,values:[11,0]});
    const rows = (await db.query(`SELECT rr.id FROM return_requests rr JOIN orders original ON original.id=rr.order_id
      WHERE TRUE ${f.clause} ORDER BY ${f.order} LIMIT $1 OFFSET $2`,f.values)).rows;
    assert.deepEqual(rows,[{id:request}]);
    const previousDay = filters({from:'2026-10-10',to:'2026-10-10'},{returns:true});
    assert.equal((await db.query(`SELECT rr.id FROM return_requests rr WHERE TRUE ${previousDay.clause}`, previousDay.values)).rows.length,0);
    const wrong = filters({requestType:'return'},{returns:true});
    assert.equal((await db.query(`SELECT rr.id FROM return_requests rr WHERE TRUE ${wrong.clause}`,wrong.values)).rows.length,0);
    const child = randomUUID();
    await db.query("UPDATE orders SET payment_method='cod' WHERE id=$1",[old]);
    await db.query("INSERT INTO orders(id,order_number,order_type,source_order_id,return_request_id) VALUES ($1,'AS-1','replacement',$2,$3)",[child,old,request]);
    const outbound = filters({search:'MH-OLD',paymentMethod:'cod',requestType:'replacement'}, {afterSales:true});
    const outboundRows = (await db.query(`SELECT o.id FROM orders o LEFT JOIN orders original ON original.id=o.source_order_id
      LEFT JOIN return_requests rr ON rr.id=o.return_request_id LEFT JOIN shipments s ON s.order_id=o.id
      WHERE o.order_type<>'normal' ${outbound.clause}`,outbound.values)).rows;
    assert.deepEqual(outboundRows,[{id:child}]);
  } finally { await db.close(); }
});
