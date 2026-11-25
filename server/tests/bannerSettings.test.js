const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
require('./helpers/rateLimitStore');
const { pool, applyBannerSettingsMigration } = require('../config/db');
const settings = require('../models/BannerSettings');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/error');
const router = require('../routes/bannerSettings');
const originals = { query: pool.query, get: settings.get, save: settings.save, find: User.findById };
afterEach(() => { pool.query = originals.query; settings.get = originals.get; settings.save = originals.save; User.findById = originals.find; });

test('banner migration preserves saved messages; model persists edits and rejects stale revisions', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await applyBannerSettingsMigration({ query: sql => db.exec(sql) });
    pool.query = (sql, params) => db.query(sql, params);
    assert.equal((await settings.get()).messages.length, 4);
    const saved = await settings.save({ messages: ['New drop', 'COD available'], revision: 0 });
    assert.equal(saved.revision, 1);
    await applyBannerSettingsMigration({ query: sql => db.exec(sql) });
    assert.deepEqual((await settings.get()).messages, ['New drop', 'COD available']);
    await assert.rejects(settings.save({ messages: ['Stale'], revision: 0 }), error => error.status === 409);
    await assert.rejects(db.query("UPDATE banner_settings SET messages = '[]'::jsonb"));
  } finally { await db.close(); }
});

test('banner reads are public; writes require admin and validate count, length, revision and plain text', async () => {
  const users = {
    admin: { id: 'admin', role: 'admin', email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'admin-google', isActive: true },
    customer: { id: 'customer', role: 'customer', firebaseUid: 'customer-google', isActive: true }
  };
  User.findById = async id => users[id];
  const content = { messages: ['Free shipping'], revision: 0 };
  let writes = 0;
  settings.get = async () => content;
  settings.save = async value => { writes++; return { ...value, revision: 1 }; };
  const app = express(); app.use(express.json()); app.use('/banner', router); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/banner`;
  const put = (body, role = 'admin') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json',
    ...(role ? { Authorization: `Bearer ${signToken(users[role], { provider: 'google.com' })}` } : {}) }, body: JSON.stringify(body) });
  try {
    const read = await fetch(url);
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), content);
    assert.equal((await put(content, null)).status, 401);
    assert.equal((await put(content, 'customer')).status, 403);
    for (const body of [null, {}, { ...content, messages: [] }, { ...content, messages: Array(13).fill('text') },
      { ...content, messages: [null] }, { ...content, messages: ['   '] }, { ...content, messages: ['x'.repeat(121)] },
      { ...content, messages: ['line\nbreak'] }, { ...content, revision: -1 }, { ...content, revision: '0' }]) {
      assert.equal((await put(body)).status, 400);
    }
    assert.equal(writes, 0);
    const saved = await put({ messages: [' New drop '], revision: 0 });
    assert.equal(saved.status, 200); assert.deepEqual((await saved.json()).messages, ['New drop']);
    settings.save = async () => { throw Object.assign(new Error('Reload before saving.'), { status: 409 }); };
    assert.equal((await put(content)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
