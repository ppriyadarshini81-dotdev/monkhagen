const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
require('./helpers/rateLimitStore');
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
const { pool } = require('../config/db');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Badge = require('../models/Badge');
const VariantOption = require('../models/VariantOption');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const originals = [
  [pool, 'query'], [Product, 'findAll'], [Product, 'findById'], [Product, 'findBySlug'],
  [Product, 'categoryProductCounts'], [Category, 'find'], [Category, 'findOne'],
  [Badge, 'find'], [VariantOption, 'find'], [User, 'findById']
].map(([object, key]) => ({ object, key, value: object[key] }));
afterEach(() => originals.forEach(({ object, key, value }) => { object[key] = value; }));
let server, base;
before(async () => {
  const app = express();
  for (const route of ['products', 'categories', 'badges', 'sizes', 'colors']) {
    app.use(`/api/${route}`, require(`../routes/${route}`));
  }
  app.use((error, _req, res, _next) => res.status(500).json({ message: 'Unexpected error.' }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('public product SQL filters inactive products and categories; protected listing can retain drafts', async () => {
  const statements = [];
  pool.query = async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; };
  await Product.findAll({ search: 'test-search' });
  assert.match(statements[0].sql, /WHERE p.is_active = TRUE AND c.is_active = TRUE AND/);
  assert.deepEqual(statements[0].params, ['%test-search%', 100, 0]);
  await Product.findAll({ activeOnly: false });
  assert.match(statements[1].sql, /WHERE TRUE ORDER BY/);
  for (const [method, value] of [['findById', '10000000-0000-4000-8000-000000000001'], ['findBySlug', 'draft-product']]) {
    await Product[method](value, { activeOnly: true, full: false });
    assert.match(statements.at(-1).sql, /AND p.is_active = TRUE AND c.is_active = TRUE/);
    assert.deepEqual(statements.at(-1).params, [value]);
    await Product[method](value, { full: false });
    assert.doesNotMatch(statements.at(-1).sql, /AND p.is_active = TRUE AND c.is_active = TRUE/);
  }
});
test('public product details filter inactive variants and size/color options without changing internal admin reads', async () => {
  const statements = [];
  pool.query = async (sql, params) => {
    statements.push({ sql, params });
    return { rows: sql.includes('p.*,') ? [{ id: 'product-id', base_price: 100, is_active: true }] : [] };
  };
  await Product.findById('product-id', { activeOnly: true });
  assert.match(statements[0].sql, /b.is_active = TRUE/);
  assert.match(statements[2].sql, /AND pv.is_active = TRUE/);
  assert.match(statements[2].sql, /s.is_active = TRUE/);
  assert.match(statements[2].sql, /c.is_active = TRUE/);
  assert.match(statements[3].sql, /AND s.is_active = TRUE/);
  assert.match(statements[4].sql, /AND c.is_active = TRUE/);
  statements.length = 0;
  await Product.findById('product-id');
  assert.doesNotMatch(statements[2].sql, /AND pv.is_active = TRUE/);
});
test('public category, badge, and option SQL applies active filters and parameterized category lookups', async () => {
  const statements = [];
  pool.query = async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; };
  await Category.find();
  await Category.findOne({ slug: 'draft-category', activeOnly: true });
  await Badge.find();
  await VariantOption.find('sizes');
  await VariantOption.find('colors');
  for (const statement of statements) assert.match(statement.sql, /is_active = TRUE/);
  assert.deepEqual(statements[1].params, ['draft-category']);
});
test('public routes ignore browser visibility flags; protected admin routes reject customers and retain drafts', async () => {
  const records = [{ id: 'published', name: 'Published', isActive: true },
    { id: 'draft', name: 'Unpublished', isActive: false }];
  const visibilityCalls = [];
  const read = options => {
    visibilityCalls.push(options.activeOnly);
    return options.activeOnly === false ? records : records.filter(row => row.isActive);
  };
  Product.findAll = async (options = {}) => read(options);
  Category.find = async (options = {}) => read(options);
  Badge.find = async (options = {}) => read(options);
  VariantOption.find = async (_table, options = {}) => read(options);
  Product.categoryProductCounts = async () => [];
  const draft = { id: '10000000-0000-4000-8000-000000000001', isActive: false };
  Product.findById = Product.findBySlug = async (_value, options = {}) => options.activeOnly ? null : draft;
  Category.findOne = async options => options.activeOnly ? null : draft;
  const users = {
    customer: { id: 'customer', role: 'customer', isActive: true, firebaseUid: 'customer-google' },
    admin: { id: 'admin', role: 'admin', isActive: true, email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'google-uid' }
  };
  User.findById = async id => users[id];
  const headers = role => ({ Authorization: `Bearer ${signToken(users[role], { provider: 'google.com' })}` });
  for (const resource of ['products', 'categories', 'badges', 'sizes', 'colors']) {
    const publicResponse = await fetch(`${base}/${resource}?activeOnly=false&includeInactive=true&role=admin`);
    assert.equal(publicResponse.status, 200);
    if (resource === 'products') assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    const visible = await publicResponse.json();
    assert.equal(visible.length, 1);
    assert.equal(visible[0].isActive, true);
    assert.equal(visibilityCalls.at(-1), resource === 'products' ? undefined : true);
    assert.equal((await fetch(`${base}/${resource}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/${resource}/admin`, { headers: headers('customer') })).status, 403);
    const adminResponse = await fetch(`${base}/${resource}/admin`, { headers: headers('admin') });
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get('cache-control'), 'no-store');
    assert.equal((await adminResponse.json()).length, 2);
    assert.equal(visibilityCalls.at(-1), false);
  }
  for (const identifier of [draft.id, 'unpublished-product']) {
    assert.equal((await fetch(`${base}/products/${identifier}`)).status, 404);
    assert.equal((await fetch(`${base}/products/admin/${identifier}`)).status, 401);
    assert.equal((await fetch(`${base}/products/admin/${identifier}`, { headers: headers('customer') })).status, 403);
    const adminResponse = await fetch(`${base}/products/admin/${identifier}`, { headers: headers('admin') });
    assert.equal(adminResponse.status, 200);
    assert.equal((await adminResponse.json()).isActive, false);
  }
  assert.equal((await fetch(`${base}/categories/unpublished-category`)).status, 404);
});
