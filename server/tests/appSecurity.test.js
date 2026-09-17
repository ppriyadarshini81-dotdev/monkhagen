const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
