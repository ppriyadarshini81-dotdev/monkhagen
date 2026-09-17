const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../config/db');
const Product = require('../models/Product');

const originalConnect = pool.connect;
const originalFindById = Product.findById;
afterEach(() => {
  pool.connect = originalConnect;
  Product.findById = originalFindById;
});

// In-memory transaction double: no database, R2, carts or orders are mutated.
function setup({ failInsert = false } = {}) {
  const rows = [
    { id: 'cart-and-order-variant', size: 'M', color: 'Blue', sku: 'TEE-M-BLUE', price: 1699, stock: 7, isActive: true },
    { id: 'other-variant', size: 'L', color: 'Blue', sku: 'TEE-L-BLUE', price: null, stock: 3, isActive: true }
  ];
  const statements = [];
  let released = false;
  pool.connect = async () => ({
    async query(sql, values) {
      statements.push(sql);
      if (sql.startsWith('DELETE FROM product_variants')) {
        throw Object.assign(new Error('Referenced by cart/order items'), { code: '23503' });
      }
      if (sql.startsWith('UPDATE product_variants SET is_active = FALSE')) {
        assert.deepEqual(values, ['product-test']);
        rows.forEach(row => { row.isActive = false; });
      }
      if (sql.includes('INSERT INTO product_variants')) {
        if (failInsert) throw new Error('Insert failed');
        assert.match(sql, /ON CONFLICT \(product_id, size, color\) DO UPDATE/);
        const [, size, color, , , sku, price, stock, active, hasSku, hasPrice] = values;
        let row = rows.find(row => row.size === size && row.color === color);
        if (!row) {
          row = { id: `new-${rows.length}`, size, color, sku, price };
          rows.push(row);
        } else {
          if (hasSku) row.sku = sku;
          if (hasPrice) row.price = price;
        }
        row.stock = stock;
        row.isActive = active;
      }
      return { rows: [] };
    },
    release() { released = true; }
  });
  Product.findById = async () => ({ id: 'product-test', variants: rows });
  return { rows, statements, released: () => released };
}

test('saving a product preserves variant IDs referenced by carts and orders', async () => {
  const state = setup();
  const result = await Product.update('product-test', {
    images: ['https://example.com/optimized.webp'],
    variants: [
      { size: 'M', color: 'Blue', stock: 7 },
      { size: 'L', color: 'Blue', stock: 3 }
    ]
  });
  assert.equal(result.variants[0].id, 'cart-and-order-variant');
  assert.equal(result.variants[1].id, 'other-variant');
  assert.equal(result.variants[0].sku, 'TEE-M-BLUE');
  assert.equal(result.variants[0].price, 1699);
  assert.ok(result.variants.every(row => row.isActive));
  assert.ok(state.statements.includes('COMMIT'));
  assert.ok(state.released());
});

test('removed combinations stay inactive and new combinations are inserted', async () => {
  const state = setup();
  await Product.update('product-test', { variants: [
    { size: 'M', color: 'Blue', stock: 5 },
    { size: 'XL', color: 'Blue', stock: 2 }
  ] });
  assert.equal(state.rows.find(row => row.id === 'other-variant').isActive, false);
  assert.equal(state.rows.find(row => row.size === 'XL').isActive, true);
  assert.equal(state.rows.find(row => row.size === 'M').id, 'cart-and-order-variant');
});

test('explicit SKU and price changes are applied, including clearing overrides', async () => {
  const state = setup();
  await Product.update('product-test', { variants: [
    { size: 'M', color: 'Blue', sku: null, price: null, stock: 7 }
  ] });
  assert.equal(state.rows[0].sku, null);
  assert.equal(state.rows[0].price, null);
});

test('an empty selection deactivates variants without deleting historical references', async () => {
  const state = setup();
  await Product.update('product-test', { variants: [] });
  assert.equal(state.rows.length, 2);
  assert.ok(state.rows.every(row => !row.isActive));
  assert.ok(state.statements.includes('COMMIT'));
});

test('a failed variant update rolls back and releases the connection', async () => {
  const state = setup({ failInsert: true });
  await assert.rejects(Product.update('product-test', {
    variants: [{ size: 'M', color: 'Blue', stock: 7 }]
  }), /Insert failed/);
  assert.ok(state.statements.includes('ROLLBACK'));
  assert.ok(!state.statements.includes('COMMIT'));
  assert.ok(state.released());
});
