const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { ensureOrder } = require('../services/afterSalesOrderService');

test('SQL outbound orders contain only rejected originals for returns, and preserve replacement mapping for exchanges', async () => {
  const db = new PGlite();
  const original = '10000000-0000-4000-8000-000000000001';
  const customer = '20000000-0000-4000-8000-000000000001';
  const actor = '30000000-0000-4000-8000-000000000001';
  const product = '40000000-0000-4000-8000-000000000001';
  const first = '50000000-0000-4000-8000-000000000001';
  const second = '50000000-0000-4000-8000-000000000002';
  const sizeM = '60000000-0000-4000-8000-000000000001';
  const sizeL = '60000000-0000-4000-8000-000000000002';
  const variantM = '70000000-0000-4000-8000-000000000001';
  const variantL = '70000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,order_number text,
      subtotal numeric,discount_amount numeric,shipping_amount numeric,total_amount numeric,payment_method text,
      payment_status text,order_status text,order_type text,source_order_id uuid,return_request_id uuid,created_by uuid,
      fulfillment_hold_reason text,updated_at timestamptz DEFAULT NOW());
      CREATE UNIQUE INDEX child_return ON orders(return_request_id) WHERE return_request_id IS NOT NULL;
      CREATE TABLE return_requests(id uuid PRIMARY KEY,user_id uuid,order_id uuid,request_type text);
      CREATE TABLE order_addresses(order_id uuid UNIQUE,full_name text,phone text,email text,address_line1 text,
        address_line2 text,landmark text,city text,state text,postal_code text,country text);
      CREATE TABLE order_items(id uuid DEFAULT gen_random_uuid(),order_id uuid,product_id uuid,variant_id uuid,
        product_name text,sku text,size text,color text,quantity integer,unit_price numeric,total_price numeric,
        fulfillment_type text,return_item_id uuid,inspection_reason text,declared_unit_price numeric);
      CREATE UNIQUE INDEX child_item ON order_items(return_item_id) WHERE return_item_id IS NOT NULL;
      CREATE TABLE return_items(id uuid PRIMARY KEY,return_request_id uuid,order_item_id uuid,quantity integer,
        inspection_status text,replacement_size text,inspection_reason text);
      CREATE TABLE sizes(id uuid PRIMARY KEY,name text);
      CREATE TABLE product_variants(id uuid PRIMARY KEY,product_id uuid,size_id uuid,color_id uuid,sku text);`);
    await db.query('INSERT INTO orders(id,user_id,order_number) VALUES ($1,$2,$3)', [original, customer, 'MH-original']);
    await db.query('INSERT INTO order_addresses(order_id,full_name,city) VALUES ($1,$2,$3)', [original, 'Test buyer', 'Test city']);
    await db.query('INSERT INTO sizes VALUES ($1,$2),($3,$4)', [sizeM, 'M', sizeL, 'L']);
    await db.query('INSERT INTO product_variants VALUES ($1,$2,$3,NULL,$4),($5,$2,$6,NULL,$7)',
      [variantM, product, sizeM, 'TEE-M', variantL, sizeL, 'TEE-L']);
    for (const id of [first, second]) await db.query(`INSERT INTO order_items
      (id,order_id,product_id,variant_id,product_name,sku,size,color,quantity,unit_price,total_price)
      VALUES ($1,$2,$3,$4,'Test tee','TEE-M','M','Black',1,1499,1499)`, [id, original, product, variantM]);
    for (const [index, type] of ['return', 'replacement'].entries()) {
      const requestId = `80000000-0000-4000-8000-00000000000${index + 1}`;
      await db.query('INSERT INTO return_requests VALUES ($1,$2,$3,$4)', [requestId, customer, original, type]);
      for (const [itemIndex, item] of [first, second].entries()) await db.query('INSERT INTO return_items VALUES ($1,$2,$3,1,$4,$5,$6)',
        [`90000000-0000-4000-8000-00000000000${index * 2 + itemIndex + 1}`, requestId, item,
          itemIndex === 0 ? 'approved' : 'rejected', 'L', itemIndex === 0 ? 'Passed inspection' : 'Used item']);
      const outbound = await ensureOrder(db, requestId, actor);
      const repeat = await ensureOrder(db, requestId, actor);
      assert.equal(repeat.id, outbound.id);
      assert.equal(outbound.order_type, type === 'return' ? 'rejected_return' : 'replacement');
      const children = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY fulfillment_type', [outbound.id])).rows;
      assert.equal(children.length, type === 'return' ? 1 : 2);
      assert.equal(children[0].size, 'M');
      assert.equal(children[0].sku, 'TEE-M');
      assert.equal(children[0].inspection_reason, 'Used item');
      assert.equal(Number(children[0].declared_unit_price), 1499);
      assert.equal(Number(children[0].total_price), 0);
      if (type === 'replacement') { assert.equal(children[1].size, 'L'); assert.equal(children[1].sku, 'TEE-L'); }
    }
  } finally { await db.close(); }
});
