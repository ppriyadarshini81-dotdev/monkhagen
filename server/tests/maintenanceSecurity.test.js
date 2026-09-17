const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const maintenance = require('../services/securityMaintenance');
const shipping = require('../services/shippingWorker');
const email = require('../services/emailWorker');
const Shipment = require('../models/Shipment');
let calls = [];
maintenance.runMaintenance = async () => { calls.push('reservations'); return { expiredReservationsChecked: 0 }; };
shipping.processShippingQueue = async () => { calls.push('shipping'); return 0; };
email.sendPendingConfirmations = async () => { calls.push('email'); return 0; };
Shipment.withLock = async (key, callback) => { assert.equal(key, 'security-maintenance'); return callback(); };
const router = require('../routes/maintenance');
const initialSecret = process.env.CRON_SECRET;
afterEach(() => { calls = []; if (initialSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = initialSecret; });
async function run(callback) {
  const app = express(); app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('maintenance is disabled without a strong configured secret and rejects public access without queue I/O', async () => {
  await run(async base => {
    delete process.env.CRON_SECRET; assert.equal((await fetch(base)).status, 503);
    process.env.CRON_SECRET = crypto.randomBytes(32).toString('hex');
    for (const authorization of ['', 'Bearer invalid', `Bearer ${process.env.CRON_SECRET}x`]) assert.equal((await fetch(base, { headers: { authorization } })).status, 401);
    assert.deepEqual(calls, []);
  });
});
test('authenticated maintenance invokes bounded queues synchronously and returns counts only', async () => {
  await run(async base => {
    process.env.CRON_SECRET = crypto.randomBytes(32).toString('hex');
    const response = await fetch(base, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { expiredReservationsChecked: 0, shippingOrdersChecked: 0, confirmationEmailsSent: 0 });
    assert.deepEqual(calls, ['reservations','shipping','email']);
  });
});
