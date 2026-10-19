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
  for (const event of ['LOGIN', 'SIGNUP', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'ORDER_CREATED']) {
    assert.equal(analyticsEvents.CLIENT_EVENTS.has(event), false, event);
  }
  assert.equal(analyticsEvents.CLIENT_EVENTS.has('PRODUCT_VIEWED'), true);
  assert.equal(analyticsEvents.CLIENT_EVENTS.has('ADD_TO_CART'), true);
  assert.equal(analyticsEvents.CLIENT_EVENTS.has('REMOVE_FROM_CART'), true);
  assert.equal(analyticsEvents.CLIENT_EVENTS.has('FRONTEND_ERROR'), true);
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

test('dashboard combines reports in one protected request and retains the admin rate limit', async () => {
  const names = ['overview', 'revenue', 'funnel', 'products', 'carts', 'payments', 'visitors', 'trend', 'logins', 'returns', 'errors'];
  const originals = Object.fromEntries(names.map(name => [name, reports[name]]));
  const calls = [];
  for (const name of names) reports[name] = async query => { calls.push({ name, query }); return { report: name }; };
  const headers = { Authorization: `Bearer ${signToken(account('admin'), { provider: 'google.com' })}` };
  try {
    const url = `${base}/api/admin/analytics/dashboard?range=custom&start=2026-10-01&end=2026-10-19&sort=views&direction=asc`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${signToken(account('customer'))}` } })).status, 403);
    assert.equal(calls.length, 0);
    // The preceding overview request consumed one of the 120 admin requests.
    // Each dashboard visit must consume just one, while returning all reports.
    for (let visit = 0; visit < 119; visit++) {
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(await response.json()), names);
    }
    assert.equal(calls.length, 119 * names.length);
    assert.deepEqual(calls[0].query, { range: 'custom', start: '2026-10-01', end: '2026-10-19', sort: 'views', direction: 'asc' });
    assert.equal((await fetch(url, { headers })).status, 429);
    assert.equal(calls.length, 119 * names.length);
  } finally { Object.assign(reports, originals); }
});
