const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { pool } = require('../config/db');
const ctrl = require('../controllers/accountController');
const { errorHandler } = require('../middleware/error');
const originalConnect = pool.connect;
const originalFetch = global.fetch;
afterEach(() => { pool.connect = originalConnect; global.fetch = originalFetch; });
const USER = '10000000-0000-4000-8000-000000000001';
const body = { fullName: 'Test Customer', phone: '9876543210', email: 'buyer@example.test', addressLine1: '123 Test Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'India' };
async function serve(run) {
  const app = express(); app.use(express.json(), (req, _res, next) => { req.user = { id: USER }; next(); });
  app.post('/', ctrl.addAddress); app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('address cap is checked under the user lock and rejected without insertion', async () => {
  global.fetch = async () => ({ ok: true, json: async () => [{ Status: 'Success', PostOffice: [{ Name: 'Bengaluru', District: 'Bengaluru', State: 'Karnataka' }] }] });
  const statements = [];
  pool.connect = async () => ({ query: async (sql, params) => {
    statements.push(sql);
    if (sql.includes('SELECT COUNT')) { assert.deepEqual(params, [USER]); return { rows: [{ count: 50 }] }; }
    if (sql.includes('INSERT')) throw new Error('Must not insert beyond cap');
    return { rows: [] };
  }, release() {} });
  await serve(async base => {
    const response = await originalFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 409);
    assert.ok(statements.findIndex(sql => sql.includes('FOR UPDATE')) < statements.findIndex(sql => sql.includes('SELECT COUNT')));
    assert.ok(statements.includes('ROLLBACK')); assert.ok(!statements.some(sql => sql.includes('INSERT')));
  });
});

test('address creation cannot bypass backend PIN-to-city/state validation', async () => {
  let connected = false;
  global.fetch = async () => ({ ok: true, json: async () => [{ Status: 'Success', PostOffice: [{ Name: 'Bangalore', District: 'Bengaluru', State: 'Karnataka' }] }] });
  pool.connect = async () => { connected = true; throw new Error('Address must not be written'); };
  await serve(async base => {
    const response = await originalFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, city: 'Ludhiana', state: 'Punjab', postalCode: '560012' }) });
    assert.equal(response.status, 400);
    assert.equal(connected, false);
  });
});
