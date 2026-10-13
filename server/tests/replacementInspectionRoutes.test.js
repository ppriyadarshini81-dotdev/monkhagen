const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
require('./helpers/rateLimitStore');
const originalSecret = process.env.JWT_SECRET;
const originalEmail = process.env.ADMIN_GOOGLE_EMAIL;
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
const User = require('../models/User');
const returns = require('../services/returnService');
const Order = require('../models/Order');
const { signToken } = require('../middleware/auth');
const router = require('../routes/adminReturns');

test('batch replacement inspection is admin-only, validates route IDs and passes the authenticated actor', async () => {
  const originalFind = User.findById;
  const originalSubmit = returns.submitReplacementInspection;
  const originalFindOrders = Order.findAll;
  const orderQueries = [];
  Order.findAll = async options => { orderQueries.push(options); return []; };
  const customer = { id: '10000000-0000-4000-8000-000000000001', role: 'customer', isActive: true };
  const admin = { id: '10000000-0000-4000-8000-000000000002', role: 'admin', isActive: true,
    email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'admin-google' };
  User.findById = async id => id === customer.id ? customer : id === admin.id ? admin : null;
  const calls = [];
  returns.submitReplacementInspection = async (...args) => { calls.push(args); return { shiprocketOutboundOrderId: 11 }; };
  const app = express(); app.use(express.json()); app.use('/api/admin/returns', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const returnId = '40000000-0000-4000-8000-000000000001';
  const base = `http://127.0.0.1:${server.address().port}/api/admin/returns`;
  const body = { items: [{ itemId: '20000000-0000-4000-8000-000000000001', decision: 'rejected', reason: 'Fabric damaged' }] };
  const post = (id, user) => fetch(`${base}/${id}/submit-inspection`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user, { provider: user.role === 'admin' ? 'google.com' : null })}` } : {}) },
    body: JSON.stringify(body) });
  try {
    assert.equal((await post(returnId)).status, 401);
    assert.equal((await post(returnId, customer)).status, 403);
    assert.equal((await post('invalid-return-id', admin)).status, 400);
    assert.equal(calls.length, 0);
    const response = await post(returnId, admin);
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], [returnId, body, admin.id]);
    assert.equal((await response.json()).shiprocketOutboundOrderId, 11);
    const get = user => fetch(`${base}/outbound-orders?limit=11&offset=10`, {
      headers: user ? { Authorization: `Bearer ${signToken(user, { provider: user.role === 'admin' ? 'google.com' : null })}` } : {}
    });
    assert.equal((await get()).status, 401);
    assert.equal((await get(customer)).status, 403);
    assert.equal((await get(admin)).status, 200);
    assert.deepEqual(orderQueries[0], { limit: 11, offset: 10, afterSales: true });
  } finally {
    User.findById = originalFind; returns.submitReplacementInspection = originalSubmit; Order.findAll = originalFindOrders;
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    if (originalEmail === undefined) delete process.env.ADMIN_GOOGLE_EMAIL; else process.env.ADMIN_GOOGLE_EMAIL = originalEmail;
    await new Promise(resolve => server.close(resolve));
  }
});
