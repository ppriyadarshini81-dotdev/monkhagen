const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PostgresRateLimitStore, createLimiter } = require('../middleware/rateLimit');

test('shared rate-limit increment uses atomic parameterized upsert with scoped hashed identities', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params }); return { rows: [{ hits: '2', reset_at: '2026-09-17T00:00:00Z' }] };
  } };
  const store = new PostgresRateLimitStore('checkout', database);
  store.init({ windowMs: 60000 });
  assert.deepEqual(await store.increment('user:customer'), { totalHits: 2, resetTime: new Date('2026-09-17T00:00:00Z') });
  assert.match(calls[0].sql, /ON CONFLICT \(key_hash\) DO UPDATE/);
  assert.match(calls[0].sql, /hits \+ 1/);
  assert.match(calls[0].params[0], /^[0-9a-f]{64}$/);
  assert.equal(calls[0].params[1], 60000);
  assert.notEqual(store.key('user:customer'), new PostgresRateLimitStore('admin', database).key('user:customer'));
  assert.equal(store.localKeys, false);
});
test('rate-limit database failure fails closed without exposing provider errors', async () => {
  const store = new PostgresRateLimitStore('login', { query: async () => { throw new Error('internal database details'); } });
  store.init({ windowMs: 60000 });
  await assert.rejects(store.increment('ip'), error => error.status === 503 && !error.message.includes('internal database'));
});
test('authenticated limiter keys by verified user and rejects requests above the limit', async () => {
  const original = PostgresRateLimitStore.prototype.increment;
  const counters = new Map();
  PostgresRateLimitStore.prototype.increment = async function(key) {
    counters.set(key, (counters.get(key) || 0) + 1);
    return { totalHits: counters.get(key), resetTime: new Date(Date.now() + 60000) };
  };
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'verified-user' }; next(); });
  app.get('/', createLimiter('test-user-limit', { limit: 2, windowMs: 60000, authenticated: true }), (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 429);
    assert.deepEqual([...counters.keys()], ['user:verified-user']);
  } finally { PostgresRateLimitStore.prototype.increment = original; await new Promise(resolve => server.close(resolve)); }
});
