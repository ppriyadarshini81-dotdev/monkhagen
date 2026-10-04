const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const analytics = require('../services/analyticsService');
const emails = require('../services/transactionalEmailService');
const sms = require('../services/transactionalSmsService');
const shipping = require('../services/shippingService');

const originals = {
  createCod: Order.createCod,
  linkOrderSession: analytics.linkOrderSession,
  recordServerEvent: analytics.recordServerEvent,
  email: emails.orderConfirmed,
  sms: sms.orderConfirmed,
  shipping: shipping.processPendingOrder
};

after(() => {
  Order.createCod = originals.createCod;
  analytics.linkOrderSession = originals.linkOrderSession;
  analytics.recordServerEvent = originals.recordServerEvent;
  emails.orderConfirmed = originals.email;
  sms.orderConfirmed = originals.sms;
  shipping.processPendingOrder = originals.shipping;
});

test('successful COD confirmation triggers email and Order Confirmed SMS independently', async () => {
  const calls = [];
  const order = { id: '10000000-0000-4000-8000-000000000001', paymentMethod: 'cod',
    paymentStatus: 'pending', status: 'confirmed' };
  Order.createCod = async () => order;
  analytics.linkOrderSession = async () => {};
  analytics.recordServerEvent = async () => {};
  emails.orderConfirmed = async () => { calls.push('email'); throw new Error('simulated email failure'); };
  sms.orderConfirmed = async id => { calls.push(`sms:${id}`); return { sent: 1, failed: 0, skipped: 0 }; };
  shipping.processPendingOrder = async () => {};
  const controller = require('../controllers/orderController');
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let error;

  await controller.create({ user: { id: 'user-id' }, body: { paymentMethod: 'cod' } }, response, value => { error = value; });

  assert.equal(error, undefined);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body, order);
  assert.deepEqual(calls, ['email', `sms:${order.id}`]);
});
