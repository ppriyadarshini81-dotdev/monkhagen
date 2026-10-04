const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');
const Product = require('../models/Product');

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalFindById = Product.findById;

afterEach(() => {
  pool.query = originalQuery;
  pool.connect = originalConnect;
  Product.findById = originalFindById;
});

function productRow() {
  return {
    id: '10000000-0000-4000-8000-000000000001', name: 'Tee', slug: 'tee', description: '',
    base_price: '100', featured: false, badge_name: null, badge_id: null, is_active: true,
    category_name: 'Tees', category_id: '20000000-0000-4000-8000-000000000001', category_slug: 'tees',
    agg_stock: 0, min_price: null, created_at: new Date(), updated_at: new Date()
  };
}

test('migration adds an optional zoom URL to each ordered product image row', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '013_product_zoom_images.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE product_images/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS zoom_image_url TEXT/i);
  assert.doesNotMatch(sql, /UPDATE product_images/i);
});

test('product detail API representation preserves positional zoom gaps', async () => {
  pool.query = async sql => {
    if (sql.includes('FROM products p')) return { rows: [productRow()] };
    if (sql.startsWith('SELECT * FROM product_images')) return { rows: [
      { id: 'i1', image_url: 'a.webp', zoom_image_url: 'a-zoom.webp', display_order: 0, is_primary: true },
      { id: 'i2', image_url: 'b.webp', zoom_image_url: null, display_order: 1, is_primary: false },
      { id: 'i3', image_url: 'c.webp', zoom_image_url: 'c-zoom.webp', display_order: 2, is_primary: false }
    ] };
    return { rows: [] };
  };
  const product = await Product.findById('10000000-0000-4000-8000-000000000001');
  assert.deepEqual(product.images, ['a.webp', 'b.webp', 'c.webp']);
  assert.deepEqual(product.zoomImages, ['a-zoom.webp', null, 'c-zoom.webp']);
  assert.equal(product.imageObjects[0].isPrimary, true);
});

test('existing products without zoom images return an empty zoom array', async () => {
  pool.query = async sql => {
    if (sql.includes('FROM products p')) return { rows: [productRow()] };
    if (sql.startsWith('SELECT * FROM product_images')) return { rows: [
      { id: 'i1', image_url: 'a.webp', display_order: 0, is_primary: true }
    ] };
    return { rows: [] };
  };
  const product = await Product.findById('10000000-0000-4000-8000-000000000001');
  assert.deepEqual(product.zoomImages, []);
});

test('saving reordered images persists display and zoom pairs in the same rows', async () => {
  const inserts = [];
  pool.connect = async () => ({
    async query(sql, values) {
      if (sql.includes('INSERT INTO product_images')) inserts.push(values);
      return { rows: [] };
    },
    release() {}
  });
  Product.findById = async id => ({ id });
  await Product.update('10000000-0000-4000-8000-000000000001', {
    images: ['c.webp', 'a.webp', 'b.webp'],
    zoomImages: ['c-zoom.webp', 'a-zoom.webp', null]
  });
  assert.deepEqual(inserts.map(values => [values[1], values[2], values[4], values[5]]), [
    ['c.webp', 'c-zoom.webp', 0, true],
    ['a.webp', 'a-zoom.webp', 1, false],
    ['b.webp', null, 2, false]
  ]);
});
