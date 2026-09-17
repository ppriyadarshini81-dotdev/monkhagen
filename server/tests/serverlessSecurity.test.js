const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'admin@example.test';
process.env.NODE_ENV = 'development';
delete process.env.CORS_ORIGINS;
require('./helpers/rateLimitStore');
require('dotenv').config = () => ({}); // Never load real integration secrets.
let initializations = 0;
require('../config/db').connectDB = async options => {
  assert.deepEqual(options, { migrate: false }); initializations++;
};
let received;
require('../services/paymentService').processWebhook = async body => {
  assert.ok(Buffer.isBuffer(body)); received = body; return { duplicate: false };
};
const handler = require('../../api/index');
test('serverless handler fails closed without parser opt-out and preserves raw bytes with warm pool reuse', async () => {
  const priorVercel = process.env.VERCEL, priorHelpers = process.env.NODEJS_HELPERS;
  process.env.VERCEL = '1'; delete process.env.NODEJS_HELPERS;
  const server = await new Promise(resolve => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 503);
    assert.equal(initializations, 0);
    process.env.NODEJS_HELPERS = '0';
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const raw = '{ "event": "test", "preserve" : true }\n';
    assert.equal((await fetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })).status, 200);
    assert.equal(received.toString(), raw); assert.equal(initializations, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (priorVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = priorVercel;
    if (priorHelpers === undefined) delete process.env.NODEJS_HELPERS; else process.env.NODEJS_HELPERS = priorHelpers;
  }
});
