const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
require('./helpers/rateLimitStore');
const User = require('../models/User');
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
const { signToken } = require('../middleware/auth');
const shipping = require('../services/shippingService');
const router = require('../routes/shipping');

test('shipping routes require authentication and admin permission for fulfillment', async () => {
  const users = {
    customer: { id: 'customer', role: 'customer', isActive: true },
    admin: { id: 'admin', role: 'admin', isActive: true, email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'admin-google' },
    super_admin: { id: 'super_admin', role: 'super_admin', isActive: true, email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'admin-google' }
  };
  const originalFind = User.findById;
  const originalCreate = shipping.createShipment;
  let calls = 0;
  User.findById = async id => users[id];
  shipping.createShipment = async () => { calls++; return { shippingStatus: 'created' }; };
  const app = express();
  app.use(express.json());
  app.use('/api/shipping', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/shipping`;
  try {
    assert.equal((await fetch(`${base}/serviceability`, { method: 'POST' })).status, 401);
    for (const route of ['create-shipment', 'order-id/assign-awb', 'order-id/generate-pickup', 'order-id/generate-label', 'order-id/reconcile']) {
      const response = await fetch(`${base}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${signToken(users.customer)}` } });
      assert.equal(response.status, 403);
    }
    assert.equal(calls, 0);
    for (const role of ['admin', 'super_admin']) {
      const response = await fetch(`${base}/create-shipment`, { method: 'POST',
        headers: { Authorization: `Bearer ${signToken(users[role], { provider: 'google.com' })}`, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 200);
    }
    assert.equal(calls, 2);
    const invalid = await fetch(`${base}/serviceability`, { method: 'POST',
      headers: { Authorization: `Bearer ${signToken(users.customer)}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'SHIPPING_VALIDATION');
  } finally {
    User.findById = originalFind;
    shipping.createShipment = originalCreate;
    await new Promise(resolve => server.close(resolve));
  }
});
