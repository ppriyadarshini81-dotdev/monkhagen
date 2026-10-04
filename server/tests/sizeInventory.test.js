const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
require('./helpers/rateLimitStore');
process.env.JWT_SECRET ||= crypto.randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'inventory-admin@example.com';
const inventory = require('../services/inventoryService');
const stock = require('../services/stockService');

const INVENTORY = '10000000-0000-4000-8000-000000000001';
const PRODUCT = '20000000-0000-4000-8000-000000000001';
const SIZE = '30000000-0000-4000-8000-000000000001';
const ORDER = '40000000-0000-4000-8000-000000000001';
const ADMIN = '50000000-0000-4000-8000-000000000001';

test('migration adds authoritative size stock and deliberately leaves existing inventory unconfigured', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/017_size_inventory.sql'), 'utf8');
  assert.match(sql, /stock_quantity INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /inventory_configured BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory_movements/);
  assert.match(sql, /quantity_after = quantity_before \+ quantity_change/);
  assert.doesNotMatch(sql, /UPDATE\s+product_size_details[\s\S]*product_variants/i);
});

function inventoryClient(opening = 1) {
  let quantity = opening;
  const movements = [];
  return {
    get quantity() { return quantity; }, movements,
    async query(statement, params = []) {
      const sql = String(statement).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('UPDATE product_size_details') && sql.includes('stock_quantity = stock_quantity -')) {
        if (quantity < params[0]) return { rows: [] };
        const before = quantity; quantity -= params[0];
        return { rows: [{ id: INVENTORY, product_id: PRODUCT, size_id: SIZE,
          quantity_before: before, quantity_after: quantity }] };
      }
      if (sql.startsWith('INSERT INTO inventory_movements')) {
        movements.push(params); return { rows: [{ id: String(movements.length) }] };
      }
      return { rows: [] };
    }
  };
}

test('atomic size deduction permits only one buyer for the final unit and records the order movement', async () => {
  const client = inventoryClient(1);
  const item = { inventory_id: INVENTORY, quantity: 1, size: 'M' };
  await inventory.deduct(client, [item], { orderId: ORDER, movementType: 'ORDER_SOLD' });
  await assert.rejects(inventory.deduct(client, [item], { orderId: ORDER, movementType: 'ORDER_SOLD' }), /insufficient stock/);
  assert.equal(client.quantity, 0);
  assert.equal(client.movements.length, 1);
  assert.equal(client.movements[0][3], 'ORDER_SOLD');
  assert.equal(client.movements[0][4], -1);
});

test('cancelling a deducted order restores the correct size once and records one cancellation movement', async () => {
  let quantity = 0; let movementCount = 0;
  const order = { id: ORDER, inventory_deducted_at: new Date(), inventory_reserved_at: null, inventory_released_at: null };
  const client = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT psd.id AS inventory_id')) return { rows: [{ inventory_id: INVENTORY,
      product_id: PRODUCT, size_id: SIZE, quantity: 1 }] };
    if (sql.startsWith('UPDATE product_size_details')) { const before = quantity; quantity += params[0];
      return { rows: [{ quantity_before: before, quantity_after: quantity }] }; }
    if (sql.startsWith('INSERT INTO inventory_movements')) { movementCount += 1; return { rows: [{ id: 'movement' }] }; }
    if (sql.startsWith('UPDATE orders SET inventory_released_at')) { order.inventory_released_at = new Date(); return { rows: [] }; }
    return { rows: [] };
  } };
  await inventory.releaseReservation(client, order);
  await inventory.releaseReservation(client, order);
  assert.equal(quantity, 1);
  assert.equal(movementCount, 1);
});

test('admin adjustment is transactional, auditable and cannot make size stock negative', async () => {
  let quantity = 4; const statements = []; const movementParams = [];
  const client = { release() {}, async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim(); statements.push(sql);
    if (sql.startsWith('SELECT psd.*')) return { rows: [{ id: INVENTORY, product_id: PRODUCT, size_id: SIZE,
      product_name: 'Test Tee', size_name: 'M', stock_quantity: quantity, inventory_configured: true }] };
    if (sql.startsWith('UPDATE product_size_details SET stock_quantity')) { quantity = params[0]; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO inventory_movements')) { movementParams.push(params); return { rows: [{ id: 'movement' }] }; }
    return { rows: [] };
  } };
  const database = { connect: async () => client };
  const result = await stock.adjust(INVENTORY, { adjustment: 3, reason: ' New delivery ' }, ADMIN, database);
  assert.equal(result.currentStock, 7);
  assert.equal(movementParams[0][3], 'ADMIN_ADJUSTMENT');
  assert.equal(movementParams[0][10], ADMIN);
  assert.equal(movementParams[0][9], 'New delivery');
  await assert.rejects(stock.adjust(INVENTORY, { adjustment: -8, reason: 'Damage' }, ADMIN, database), /below zero/);
  assert.equal(quantity, 7);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('stock list applies combined filters, defaults to problems-first and returns pagination and summary', async () => {
  const calls = [];
  const database = { async query(sql, params) {
    sql = String(sql); calls.push({ sql, params });
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
    if (sql.includes('COUNT(DISTINCT p.id)')) return { rows: [{ total_products: 1, total_units: 2,
      low_stock_sizes: 1, out_of_stock_sizes: 0, setup_required_sizes: 0 }] };
    return { rows: [{ inventory_id: INVENTORY, product_id: PRODUCT, product_name: 'Test Tee', product_slug: 'test-tee',
      category_id: 'category', category_name: 'Tees', size_id: SIZE, size_name: 'M', stock_quantity: 2,
      initial_stock_quantity: 10, low_stock_threshold_quantity: 2, inventory_configured: true,
      updated_at: new Date(), stock_status: 'LOW_STOCK', image_url: null }] };
  } };
  const result = await stock.list({ search: 'tee', status: 'LOW_STOCK', category: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    size: SIZE, page: 1, limit: 25 }, database);
  assert.equal(result.items[0].remainingPercent, 20);
  assert.equal(result.summary.lowStockSizes, 1);
  assert.equal(result.pagination.total, 1);
  assert.ok(calls[0].sql.includes('ILIKE'));
  assert.ok(calls[0].sql.includes('stock_quantity <= psd.low_stock_threshold_quantity'));
  assert.ok(calls[1].sql.includes("WHEN 'SETUP_REQUIRED' THEN 0"));
});

test('stock history exposes immutable movement context without exact stock writes', async () => {
  const database = { async query(sql) {
    if (String(sql).startsWith('SELECT id FROM product_size_details')) return { rows: [{ id: INVENTORY }] };
    return { rows: [{ id: 'movement', movement_type: 'RETURN_RESTOCKED', quantity_change: 1,
      quantity_before: 0, quantity_after: 1, reason: 'Approved return', created_at: new Date(),
      order_number: null, return_number: 'R-1', created_by_name: null }] };
  } };
  const result = await stock.history(INVENTORY, database);
  assert.deepEqual(result[0], { id: 'movement', type: 'RETURN_RESTOCKED', quantityChange: 1,
    quantityBefore: 0, quantityAfter: 1, reason: 'Approved return', orderNumber: null,
    returnNumber: 'R-1', createdBy: 'System', createdAt: result[0].createdAt });
});

describe('stock route authorization', () => {
  const User = require('../models/User');
  const stockService = require('../services/stockService');
  const originalFind = User.findById;
  const originalList = stockService.list;
  const { signToken } = require('../middleware/auth');
  let server; let base;
  const account = role => ({ id: `${role}-id`, role, name: role, isActive: true, sessionVersion: 0,
    email: role === 'customer' ? 'customer@example.test' : process.env.ADMIN_GOOGLE_EMAIL,
    firebaseUid: `${role}-google-uid` });
  before(async () => {
    User.findById = async id => account(String(id).replace('-id', ''));
    stockService.list = async () => ({ items: [], summary: { totalProducts: 0, totalUnits: 0,
      lowStockSizes: 0, outOfStockSizes: 0, setupRequiredSizes: 0 }, pagination: { page: 1, limit: 25, total: 0, pages: 1 } });
    const app = express(); app.use('/api/admin/stock', require('../routes/adminStock'));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: 'failed' }));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { User.findById = originalFind; stockService.list = originalList;
    await new Promise(resolve => server.close(resolve)); });
  test('customers cannot view stock while admin and superadmin can', async () => {
    assert.equal((await fetch(`${base}/api/admin/stock`)).status, 401);
    const customer = account('customer');
    assert.equal((await fetch(`${base}/api/admin/stock`, { headers: { Authorization: `Bearer ${signToken(customer, { provider: 'google.com' })}` } })).status, 403);
    for (const role of ['admin', 'super_admin']) {
      const user = account(role);
      const response = await fetch(`${base}/api/admin/stock`, { headers: { Authorization: `Bearer ${signToken(user, { provider: 'google.com' })}` } });
      assert.equal(response.status, 200);
    }
  });
});
