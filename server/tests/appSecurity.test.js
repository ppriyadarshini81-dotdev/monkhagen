const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'admin@example.test';
process.env.NODE_ENV = 'development';
delete process.env.CORS_ORIGINS;
require('./helpers/rateLimitStore');
const payments = require('../services/paymentService');
let received;
payments.processWebhook = async body => {
  assert.ok(Buffer.isBuffer(body)); received = body;
  return { duplicate: false };
};
const { createApp } = require('../app');
test('shared Express factory preserves exact webhook bytes and rejects malformed API requests safely', async () => {
  const app = createApp();
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = '{  "event" : "payment.captured", "test" : 1 }\n';
    const response = await fetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    assert.equal(response.status, 200); assert.equal(received.toString(), raw);
    const invalid = await fetch(`${base}/api/auth/firebase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{private_test_content' });
    assert.equal(invalid.status, 400); assert.ok(!(await invalid.text()).includes('private_test_content'));
    assert.equal((await fetch(`${base}/api/products?search[nested]=value`)).status, 400);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'https://attacker.example.test' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

function setAppEnvironment(t, mode) {
  const previousMode = process.env.NODE_ENV;
  const previousOrigins = process.env.CORS_ORIGINS;
  process.env.NODE_ENV = mode;
  if (mode === 'production') process.env.CORS_ORIGINS = 'https://frontend.example.test';
  else delete process.env.CORS_ORIGINS;
  t.after(() => {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
  });
}

test('production is API-only, with root JSON and unchanged health/webhook/validation behavior', async t => {
  setAppEnvironment(t, 'production');
  t.mock.method(express, 'static', () => { throw new Error('Production must not register static serving'); });
  const app = createApp();
  t.mock.method(app.response, 'sendFile', () => { throw new Error('Production must not serve Angular'); });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('Content-Type'), /^application\/json/);
    assert.deepEqual(await root.json(), { status: 'ok', service: 'Monk Hagen API' });
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', brand: 'Monk Hagen' });
    for (const route of ['/products', '/login', '/index.html', '/main.js', '/api/missing']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, route);
      assert.deepEqual(await response.json(), { message: 'Route not found.' });
    }
    assert.equal((await fetch(`${base}/api/products?search[nested]=value`)).status, 400);
    assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'https://attacker.example.test' } })).status, 403);
    const raw = '{  "event" : "payment.captured", "test" : 1 }\n';
    const webhook = await fetch(`${base}/api/webhooks/razorpay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw
    });
    assert.equal(webhook.status, 200);
    assert.equal(received.toString(), raw);
    assert.equal(express.static.mock.callCount(), 0);
    assert.equal(app.response.sendFile.mock.callCount(), 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('development retains static assets, SPA fallback and localhost API access', async t => {
  setAppEnvironment(t, 'development');
  const directory = path.join(__dirname, '..', '..', 'dist', 'clothing-ui', 'browser');
  // Mock file delivery so this regression check does not require an Angular build.
  t.mock.method(express, 'static', actualDirectory => {
    assert.equal(actualDirectory, directory);
    return (req, res, next) => req.path === '/fixture.js' ? res.type('js').send('fixture') : next();
  });
  const app = createApp();
  t.mock.method(app.response, 'sendFile', function(file) {
    assert.equal(file, path.join(directory, 'index.html'));
    this.type('html').send('<app-root>development fixture</app-root>');
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await (await fetch(`${base}/fixture.js`)).text(), 'fixture');
    for (const route of ['/', '/products', '/account/profile']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type'), /^text\/html/);
      assert.match(await response.text(), /development fixture/);
    }
    assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:4200' } })).status, 200);
    assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
