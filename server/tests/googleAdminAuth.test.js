const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
const User = require('../models/User');
const firebaseAdmin = require('../config/firebaseAdmin');
const originalAuth = firebaseAdmin.getAuth;
let decoded, verificationError, verificationCalls, stored, mutations;
firebaseAdmin.getAuth = () => ({ verifyIdToken: async (token, checkRevoked) => {
  verificationCalls.push({ token, checkRevoked });
  if (verificationError) throw verificationError;
  return decoded;
} });
const { signToken, authenticate, requireAdmin, JWT_SECRET } = require('../middleware/auth');
const router = require('../routes/auth');
const { applyGoogleAdminMigration } = require('../config/db');
const originalMethods = Object.fromEntries(['findById', 'findByFirebaseUid', 'findOne',
  'createFirebaseUser', 'linkFirebaseUid', 'updateFirebaseUser', 'setRole'].map(key => [key, User[key]]));
let server, base;
function user(overrides = {}) {
  const value = { id: 'account-id', email: process.env.ADMIN_GOOGLE_EMAIL, role: 'admin',
    firebaseUid: 'google-uid', isActive: true, ...overrides };
  return { ...value, toJSON: () => ({ ...value }) };
}
before(async () => {
  const app = express();
  app.use(express.json());
  // Exercise provider policy repeatedly without exhausting the real login
  // limiter. Compatibility and removed routes still use the actual router.
  app.post('/api/auth/firebase', require('../controllers/firebaseAuthController').firebaseLogin);
  app.use('/api/auth', router);
  app.get('/protected', authenticate, requireAdmin, (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(500).json({ message: 'Unexpected error.' }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  Object.assign(User, originalMethods);
  firebaseAdmin.getAuth = originalAuth;
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
  decoded = { uid: 'google-uid', email: process.env.ADMIN_GOOGLE_EMAIL, email_verified: true,
    firebase: { sign_in_provider: 'google.com' } };
  verificationError = null;
  verificationCalls = [];
  stored = null;
  mutations = [];
  User.findById = async () => stored;
  User.findByFirebaseUid = async uid => stored?.firebaseUid === uid ? stored : null;
  User.findOne = async ({ email }) => stored?.email === email ? stored : null;
  User.createFirebaseUser = async fields => {
    mutations.push('create'); stored = user(fields); return stored;
  };
  User.linkFirebaseUid = async (id, fields) => {
    mutations.push('link'); stored = user({ ...stored, firebaseUid: fields.uid }); return stored;
  };
  User.updateFirebaseUser = async () => { mutations.push('update'); return stored; };
  User.setRole = async (id, role) => { mutations.push('role'); stored = user({ ...stored, role }); return stored; };
});
const login = (body = { idToken: 'mock-token' }, endpoint = 'firebase') => fetch(`${base}/api/auth/${endpoint}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const protectedRequest = token => fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${token}` } });

test('designated Google identity gets admin access with server-verified provider and UID', async () => {
  const response = await login({ idToken: 'mock-token', role: 'super_admin', email: 'ignored@example.com' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.user.role, 'admin');
  assert.deepEqual(verificationCalls, [{ token: 'mock-token', checkRevoked: true }]);
  const claims = jwt.verify(result.token, JWT_SECRET);
  assert.equal(claims.provider, 'google.com');
  assert.equal(claims.firebaseUid, 'google-uid');
  assert.equal((await protectedRequest(result.token)).status, 200);
});
test('designated existing customer is promoted only after Google verification', async () => {
  stored = user({ role: 'customer' });
  assert.equal((await login()).status, 200);
  assert.equal(stored.role, 'admin');
  assert.deepEqual(mutations, ['update', 'role']);
});
test('unlinked designated account is linked without deleting its history', async () => {
  stored = user({ role: 'customer', firebaseUid: null });
  assert.equal((await login()).status, 200);
  assert.deepEqual(mutations, ['link', 'role']);
  assert.equal(stored.id, 'account-id');
});
test('administrator cannot sign in via Firebase password provider even for an existing UID', async () => {
  stored = user();
  decoded.firebase.sign_in_provider = 'password';
  assert.equal((await login()).status, 403);
  assert.deepEqual(mutations, []);
});
test('other verified email/password customers remain customers despite browser-supplied roles', async () => {
  decoded.email = 'customer@example.com';
  decoded.firebase.sign_in_provider = 'password';
  const response = await login({ idToken: 'mock-token', role: 'admin', ADMIN_GOOGLE_EMAIL: decoded.email });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'customer');
});
test('other privileged identities and disabled users are rejected before account mutations', async () => {
  stored = user({ email: 'retired@example.com' });
  decoded.email = stored.email;
  assert.equal((await login()).status, 403);
  assert.deepEqual(mutations, []);
  decoded.email = process.env.ADMIN_GOOGLE_EMAIL;
  stored = user({ isActive: false });
  assert.equal((await login({}, 'google')).status, 400);
  assert.equal((await login(undefined, 'google')).status, 403);
  assert.deepEqual(mutations, []);
});
test('existing email binding cannot be overwritten by a different Firebase UID', async () => {
  stored = user({ firebaseUid: 'original-uid' });
  assert.equal((await login()).status, 403);
  assert.deepEqual(mutations, []);
});
test('invalid, revoked, and unverified Firebase tokens cannot create accounts', async () => {
  verificationError = new Error('revoked');
  assert.equal((await login()).status, 401);
  verificationError = null;
  decoded.email_verified = false;
  assert.equal((await login()).status, 403);
  assert.equal((await login({ idToken: {} })).status, 400);
  assert.deepEqual(mutations, []);
});
test('legacy password endpoint is removed', async () => {
  assert.equal((await login({}, 'login')).status, 404);
});
test('admin and legacy superadmin have identical Google-only authorization', async () => {
  for (const role of ['admin', 'super_admin']) {
    stored = user({ role });
    assert.equal((await protectedRequest(signToken(stored, { provider: 'google.com' }))).status, 200);
    assert.equal((await protectedRequest(signToken(stored))).status, 403);
    assert.equal((await protectedRequest(signToken(stored, { provider: 'password' }))).status, 403);
  }
});
test('database identity, activity, and UID are rechecked on every privileged request', async () => {
  const token = signToken(user(), { provider: 'google.com' });
  for (const changes of [{ email: 'other@example.com' }, { isActive: false }, { firebaseUid: 'changed' },
    { role: 'customer' }]) {
    stored = user(changes);
    assert.equal((await protectedRequest(token)).status, 403);
  }
  stored = user({ role: 'customer', email: 'customer@example.com', isActive: false });
  const response = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${signToken(stored)}` } });
  assert.equal(response.status, 403);
});
test('privileged password cleanup is parameterized and preserves customer records', async () => {
  let statement, parameters;
  await applyGoogleAdminMigration({ query: async (sql, params) => { statement = sql; parameters = params; } });
  assert.deepEqual(parameters, [process.env.ADMIN_GOOGLE_EMAIL]);
  assert.match(statement, /password_hash = NULL/);
  assert.match(statement, /ELSE FALSE END/);
  assert.match(statement, /r.name IN \('admin', 'super_admin'\)/);
  assert.doesNotMatch(statement, /DELETE|DROP|TRUNCATE/i);
});
