const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
require('./helpers/rateLimitStore');
const User = require('../models/User');
const firebaseAdmin = require('../config/firebaseAdmin');
const firebaseSession = require('../services/firebaseSession');
const { signToken, authenticate, JWT_SECRET } = require('../middleware/auth');
const originals = { find: User.findById, revoke: User.revokeSessions, getAuth: firebaseAdmin.getAuth };
afterEach(() => { User.findById = originals.find; User.revokeSessions = originals.revoke; firebaseAdmin.getAuth = originals.getAuth; firebaseSession.invalidate('test-uid'); });

async function run(callback) {
  let user = { id: 'user-id', role: 'customer', email: 'customer@example.com', firebaseUid: 'test-uid', isActive: true, sessionVersion: 0 };
  User.findById = async () => user;
  User.revokeSessions = async () => { user.sessionVersion++; };
  firebaseAdmin.getAuth = () => ({ getUser: async uid => ({ uid, disabled: false, emailVerified: true, tokensValidAfterTime: '1970-01-01T00:00:00Z' }) });
  const app = express(); app.use(express.json()); app.get('/', authenticate, (_req, res) => res.json({ ok: true })); app.use('/auth', require('../routes/auth'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = token => fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  try { await callback({ user, request, base }); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('tokens have bounded lifetimes, explicit issuer/audience and revocation version', () => {
  process.env.JWT_EXPIRES_IN = '7d';
  for (const role of ['customer','admin','super_admin']) {
    const claims = jwt.verify(signToken({ id: 'test', role }), JWT_SECRET);
    assert.equal(claims.iss, 'monkhagen-api'); assert.equal(claims.aud, 'monkhagen-web');
    assert.equal(claims.exp - claims.iat, role === 'customer' ? 3600 : 900); assert.equal(claims.sessionVersion, 0);
  }
  delete process.env.JWT_EXPIRES_IN;
});
test('logout invalidates all existing application sessions server-side', async () => {
  await run(async ({ user, request, base }) => {
    const token = signToken(user, { provider: 'password' }); assert.equal((await request(token)).status, 200);
    assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 204);
    assert.equal((await request(token)).status, 401);
    assert.equal((await request(signToken(user, { provider: 'password' }))).status, 200);
  });
});
test('legacy, wrong-audience, expired and changed-role tokens are rejected', async () => {
  await run(async ({ user, request }) => {
    for (const token of [jwt.sign({ sub: user.id }, JWT_SECRET),
      jwt.sign({ sub: user.id }, JWT_SECRET, { audience: 'other', issuer: 'monkhagen-api', expiresIn: 3600 }),
      jwt.sign({ sub: user.id }, JWT_SECRET, { audience: 'monkhagen-web', issuer: 'monkhagen-api', expiresIn: -1 })]) assert.equal((await request(token)).status, 401);
    const token = signToken(user); user.role = 'admin'; assert.equal((await request(token)).status, 403);
  });
});
test('Firebase disabled/revoked sessions are rejected and provider failures fail closed', async () => {
  await run(async ({ user, request }) => {
    const token = signToken(user, { provider: 'password' });
    for (const record of [{ uid: 'test-uid', disabled: true }, { uid: 'test-uid', tokensValidAfterTime: new Date(Date.now() + 60000).toISOString() }]) {
      firebaseSession.invalidate('test-uid'); firebaseAdmin.getAuth = () => ({ getUser: async () => record }); assert.equal((await request(token)).status, 401);
    }
    firebaseSession.invalidate('test-uid'); firebaseAdmin.getAuth = () => ({ getUser: async () => { throw new Error('provider private details'); } });
    const response = await request(token); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private'));
  });
});
