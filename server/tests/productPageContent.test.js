const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { pool, applyProductPageContentMigration, applySizeChartCareMigration } = require('../config/db');
const Content = require('../models/ProductPageContent');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/error');
const router = require('../routes/productPageContent');

const originalQuery = pool.query;
const originalGet = Content.get;
const originalSave = Content.save;
const originalFind = User.findById;
afterEach(() => {
  pool.query = originalQuery;
  Content.get = originalGet;
  Content.save = originalSave;
  User.findById = originalFind;
});

const content = {
  sizeChartImageUrl: 'https://example.com/size-guide.webp',
  careInstructions: 'Wash cold.\nDry flat.',
  deliveryEstimate: '3–5 business days',
  deliveryNote: 'Remote areas may take longer.'
};

test('shared content is read and saved using parameterized SQL and only public fields', async () => {
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ id: true, size_chart_image_url: content.sizeChartImageUrl,
      care_instructions: content.careInstructions, delivery_estimate: content.deliveryEstimate,
      delivery_note: content.deliveryNote, updated_at: '2026-09-17T00:00:00Z' }] };
  };
  assert.equal((await Content.get()).deliveryEstimate, content.deliveryEstimate);
  const result = await Content.save(content);
  assert.equal(result.careInstructions, content.careInstructions);
  assert.equal('id' in result, false);
  assert.deepEqual(queries[1].params, Object.values(content));
  assert.match(queries[1].sql, /ON CONFLICT \(id\) DO UPDATE/);
});

test('missing shared content does not invent hardcoded storefront values', async () => {
  pool.query = async () => ({ rows: [] });
  assert.equal(await Content.get(), null);
});

test('content migration is additive and never overwrites existing administrator edits', async () => {
  let sql;
  await applyProductPageContentMigration({ query: async statement => { sql = statement; } });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS product_page_content/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(sql, /CHECK \(id = TRUE\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE products|ALTER TABLE products/i);
});

test('chart and care seed only fills blank shared fields and preserves existing content', async () => {
  let sql;
  await applySizeChartCareMigration({ query: async statement => { sql = statement; } });
  assert.match(sql, /CASE WHEN size_chart_image_url = '' THEN/);
  assert.match(sql, /ELSE size_chart_image_url END/);
  assert.match(sql, /ELSE care_instructions END/);
  assert.match(sql, /monk_hagen_size_chart_under_150kb\.webp/);
  for (const instruction of ['Machine wash cold or at 30°C', 'Wash inside out', 'Wash with similar colours', 'Do not bleach', 'Do not soak for prolonged periods', 'Avoid direct ironing on the print']) {
    assert.ok(sql.includes(instruction));
  }
  assert.doesNotMatch(sql, /UPDATE products|DELETE FROM|DROP TABLE/i);
});

test('public reads and admin-only edits validate and whitelist shared content', async () => {
  const users = { customer: { id: 'customer', role: 'customer' },
    admin: { id: 'admin', role: 'admin' }, super_admin: { id: 'super_admin', role: 'super_admin' } };
  User.findById = async id => users[id];
  let getValue = content;
  let saved = [];
  Content.get = async () => getValue;
  Content.save = async value => { saved.push(value); return value; };
  const app = express();
  app.use(express.json());
  app.use('/api/product-page-content', router);
  app.use(errorHandler);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/product-page-content`;
  const put = (body, role = 'admin') => fetch(base, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${signToken(users[role])}` } : {}) },
    body: JSON.stringify(body) });
  try {
    const publicRead = await fetch(base);
    assert.equal(publicRead.status, 200);
    assert.equal(publicRead.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await publicRead.json(), content);
    assert.equal((await put(content, null)).status, 401);
    assert.equal((await put(content, 'customer')).status, 403);
    assert.equal(saved.length, 0);

    for (const invalid of [
      { ...content, deliveryEstimate: '   ' },
      { ...content, careInstructions: 'a'.repeat(10001) },
      { ...content, deliveryEstimate: 'a'.repeat(201) },
      { ...content, deliveryNote: 'a'.repeat(2001) },
      { ...content, deliveryNote: null },
      { ...content, sizeChartImageUrl: 'javascript:alert(1)' },
      { ...content, sizeChartImageUrl: 'http://example.com/chart.png' },
      { ...content, sizeChartImageUrl: 'https://user:password@example.com/chart.png' },
      {}
    ]) assert.equal((await put(invalid)).status, 400);
    assert.equal(saved.length, 0);

    for (const role of ['admin', 'super_admin']) {
      const response = await put({ ...content, deliveryEstimate: '  5 days  ', unauthorizedField: 'ignored' }, role);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.deliveryEstimate, '5 days');
      assert.equal('unauthorizedField' in result, false);
    }
    assert.equal(saved.length, 2);
    assert.equal((await put({ ...content, sizeChartImageUrl: '', careInstructions: '', deliveryNote: '' })).status, 200);
    getValue = null;
    assert.equal((await fetch(base)).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
