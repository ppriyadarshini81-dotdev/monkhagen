const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.test';
require('./helpers/rateLimitStore');

const reports = require('../services/analyticsReportService');
const User = require('../models/User');
const originalFind = User.findById;
const originalOverview = reports.overview;
const { signToken } = require('../middleware/auth');
const router = require('../routes/adminAnalytics');
const analyticsEvents = require('../services/analyticsService');
let server;
let base;

function account(role) {
  return {
    id: `${role}-id`, role, name: role, isActive: true,
    email: role === 'admin' ? process.env.ADMIN_GOOGLE_EMAIL : `${role}@example.test`,
    firebaseUid: role === 'admin' ? 'administrator-google-uid' : 'customer-uid',
    sessionVersion: 0
  };
}

before(async () => {
  reports.overview = async () => ({ period: { range: 'today' }, metrics: { visitors: { value: 1 } } });
  User.findById = async id => id === 'admin-id' ? account('admin') : account('customer');
  const app = express();
  app.use('/api/admin/analytics', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: 'failed' }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  User.findById = originalFind;
  reports.overview = originalOverview;
  await new Promise(resolve => server.close(resolve));
});

test('analytics ranges use inclusive business dates and reject unsafe custom ranges', () => {
  const { resolvePeriod } = reports;
  const fixed = new Date('2026-09-19T10:00:00Z');
  const seven = resolvePeriod({ range: '7d' }, fixed);
  assert.equal(seven.timezone, 'Asia/Kolkata');
  assert.equal(seven.startDate, '2026-09-13');
  assert.equal(seven.endDate, '2026-09-19');
  assert.throws(() => resolvePeriod({ range: 'custom', start: '2025-01-01', end: '2026-09-19' }, fixed), /366/);
  assert.throws(() => resolvePeriod({ range: 'custom', start: 'invalid', end: '2026-09-19' }, fixed), /valid custom/);
});

test('browser analytics strips query data and cannot claim authoritative commerce outcomes', () => {
  assert.equal(analyticsEvents.cleanPath('/product/example?email=private@example.test#details'), '/product/example');
  assert.equal(analyticsEvents.cleanPath('https://attacker.example.test/path'), null);
  for (const event of ['LOGIN', 'SIGNUP', 'ADD_TO_CART', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'ORDER_CREATED']) {
    assert.equal(analyticsEvents.CLIENT_EVENTS.has(event), false, event);
  }
  assert.equal(analyticsEvents.CLIENT_EVENTS.has('PRODUCT_VIEWED'), true);
});

test('analytics reporting is unavailable anonymously and to customers but available to the designated admin', async () => {
  assert.equal((await fetch(`${base}/api/admin/analytics/overview`)).status, 401);
  const customer = account('customer');
  const customerToken = signToken(customer, { provider: 'google.com' });
  assert.equal((await fetch(`${base}/api/admin/analytics/overview`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  })).status, 403);

  const admin = account('admin');
  const adminToken = signToken(admin, { provider: 'google.com' });
  const response = await fetch(`${base}/api/admin/analytics/overview`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).metrics.visitors.value, 1);
});
