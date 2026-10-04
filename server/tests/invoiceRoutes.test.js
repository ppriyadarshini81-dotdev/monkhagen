const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
require('./helpers/rateLimitStore');
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL ||= 'administrator@example.test';
const User = require('../models/User');
const shipping = require('../services/shippingService');
const { signToken } = require('../middleware/auth');
const accountRouter = require('../routes/account');

const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const customer = { id: 'customer', role: 'customer', isActive: true, sessionVersion: 0 };
const originals = { findById: User.findById, invoice: shipping.invoice };

afterEach(() => {
  User.findById = originals.findById;
  shipping.invoice = originals.invoice;
});

test('customer invoice route requires authentication and uses the authenticated user', async () => {
  User.findById = async id => id === customer.id ? customer : null;
  const calls = [];
  shipping.invoice = async (orderId, user) => {
    calls.push({ orderId, userId: user.id });
    return { document: Buffer.from('%PDF-1.4 test invoice'), filename: 'MH-1_Invoice_101.pdf' };
  };
  const app = express();
  app.use(express.json());
  app.use('/api/account', accountRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/account/orders/${ORDER_ID}/invoice`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(calls.length, 0);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${signToken(customer)}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="MH-1_Invoice_101.pdf"');
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(calls, [{ orderId: ORDER_ID, userId: customer.id }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
