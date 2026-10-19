const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const stock = require('../services/stockService');

test('product pagination keeps all matching sizes together and preserves filters and legacy pagination', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE categories (id uuid, name text);
      CREATE TABLE products (id uuid, name text, slug text, category_id uuid, is_active boolean);
      CREATE TABLE sizes (id uuid, name text);
      CREATE TABLE product_size_details (id uuid, product_id uuid, size_id uuid, stock_quantity integer,
        initial_stock_quantity integer, low_stock_threshold_quantity integer, inventory_configured boolean,
        updated_at timestamp, is_active boolean);
      CREATE TABLE product_images (product_id uuid, image_url text, is_primary boolean, display_order integer, created_at timestamp);
      CREATE TABLE product_variants (product_id uuid, size_id uuid, sku text);`);
    const category = randomUUID();
    const size = randomUUID();
    await db.query('INSERT INTO categories VALUES ($1, $2)', [category, 'Tees']);
    await db.query('INSERT INTO sizes VALUES ($1, $2)', [size, 'M']);
    const first = randomUUID();
    for (let product = 0; product < 26; product++) {
      const id = product === 0 ? first : randomUUID();
      await db.query('INSERT INTO products VALUES ($1, $2, $3, $4, TRUE)', [id, `Tee ${String(product).padStart(2, '0')}`, `tee-${product}`, category]);
      for (let variant = 0; variant < (product === 0 ? 30 : 1); variant++) {
        const sizeId = product === 0 ? randomUUID() : size;
        if (product === 0) await db.query('INSERT INTO sizes VALUES ($1, $2)', [sizeId, `Size ${variant}`]);
        await db.query(`INSERT INTO product_size_details VALUES ($1,$2,$3,$4,20,5,TRUE,NOW(),TRUE)`,
          [randomUUID(), id, sizeId, product === 0 && variant === 0 ? 2 : 20]);
      }
    }
    const page = await stock.list({ groupBy: 'product', sort: 'product', limit: 25 }, db);
    assert.equal(page.pagination.total, 26);
    assert.equal(page.pagination.pages, 2);
    assert.equal(new Set(page.items.map(item => item.productId)).size, 25);
    assert.equal(page.items.filter(item => item.productId === first).length, 30);
    const next = await stock.list({ groupBy: 'product', sort: 'product', limit: 25, page: 2 }, db);
    assert.equal(next.items.length, 1);
    assert.ok(next.items.every(item => item.productId !== first));
    const low = await stock.list({ groupBy: 'product', status: 'LOW_STOCK', search: 'Tee 00' }, db);
    assert.equal(low.pagination.total, 1);
    assert.equal(low.items.length, 1);
    assert.equal(low.items[0].status, 'LOW_STOCK');
    const sized = await stock.list({ groupBy: 'product', size }, db);
    assert.equal(sized.pagination.total, 25);
    assert.equal(sized.items.length, 25);
    const legacy = await stock.list({ sort: 'product' }, db);
    assert.equal(legacy.pagination.total, 55);
    assert.equal(legacy.items.length, 25);
  } finally { await db.close(); }
});
