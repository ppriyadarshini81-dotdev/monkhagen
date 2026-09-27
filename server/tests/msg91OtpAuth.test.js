const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.test';
process.env.MSG91_AUTH_KEY = 'test-auth-key';
process.env.MSG91_TEMPLATE_ID = 'test-template-id';
require('./helpers/rateLimitStore');

const User = require('../models/User');
const msg91 = require('../services/msg91OtpService');
const controller = require('../controllers/otpController');
const { errorHandler } = require('../middleware/error');
const originalUserMethods = Object.fromEntries(
  ['findByPhone', 'createByPhone', 'updateLastLogin'].map(key => [key, User[key]])
);
const originalProvider = { sendOtp: msg91.sendOtp, verifyOtp: msg91.verifyOtp };
let stored, createCalls, lastLoginCalls, sentPhones, verifiedRequests, sendFailure;
let server, base;

function customer(overrides = {}) {
  const value = {
    id: crypto.randomUUID(), name: 'Customer', email: null, phone: '9876543210',
    role: 'customer', phoneVerified: true, isActive: true, sessionVersion: 0, ...overrides
  };
  return { ...value, toJSON: () => ({ ...value }) };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/otp/send', controller.sendOtp);
  app.post('/api/auth/otp/verify', controller.verifyOtp);
  app.use(errorHandler);
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(User, originalUserMethods);
  Object.assign(msg91, originalProvider);
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  stored = null;
  createCalls = 0;
  lastLoginCalls = 0;
  sentPhones = [];
  verifiedRequests = [];
  sendFailure = null;
  User.findByPhone = async phone => stored?.phone === phone ? stored : null;
  User.createByPhone = async ({ phone, name }) => {
    createCalls += 1;
    stored = customer({ phone, name });
    return stored;
  };
  User.updateLastLogin = async () => { lastLoginCalls += 1; };
  msg91.sendOtp = async phone => {
    sentPhones.push(phone);
    if (sendFailure) throw sendFailure;
  };
  msg91.verifyOtp = async (phone, otp) => {
    verifiedRequests.push({ phone, otp });
    return otp === '654321';
  };
});

function post(path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('valid OTP send normalizes an Indian number and never exposes provider details', async () => {
  const response = await post('/api/auth/otp/send', { phone: '+91 98765 43210' });
  assert.equal(response.status, 200);
  assert.deepEqual(sentPhones, ['+919876543210']);
  assert.deepEqual(await response.json(), { message: 'Verification code sent.' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('invalid Indian mobile numbers are rejected before MSG91 is called', async () => {
  for (const phone of ['1234567890', '987654321', 'not-a-phone', '', null]) {
    const response = await post('/api/auth/otp/send', { phone });
    assert.equal(response.status, 400);
  }
  assert.equal(sentPhones.length, 0);
});

test('successful verification creates one customer and returns the existing app JWT', async () => {
  const response = await post('/api/auth/otp/verify', { phone: '9876543210', otp: '654321', phoneVerified: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, stored.id);
  assert.equal(body.user.phone, '9876543210');
  assert.equal(body.user.role, 'customer');
  assert.equal(body.user.name, 'User');
  assert.equal(body.isNewUser, true);
  assert.equal(typeof body.token, 'string');
  const claims = jwt.verify(body.token, process.env.JWT_SECRET, {
    algorithms: ['HS256'], issuer: 'monkhagen-api', audience: 'monkhagen-web'
  });
  assert.equal(claims.sub, stored.id);
  assert.equal(claims.role, 'customer');
  assert.equal(claims.provider, null);
  assert.equal(createCalls, 1);
  assert.deepEqual(verifiedRequests, [{ phone: '+919876543210', otp: '654321' }]);
});

test('existing verified OTP customer logs into the same account without duplication', async () => {
  stored = customer();
  const id = stored.id;
  const response = await post('/api/auth/otp/verify', { phone: '919876543210', otp: '654321' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, id);
  assert.equal(body.isNewUser, false);
  assert.equal(createCalls, 0);
  assert.equal(lastLoginCalls, 1);
});

test('incorrect or expired OTP never creates a customer', async () => {
  const response = await post('/api/auth/otp/verify', { phone: '9876543210', otp: '000000' });
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /incorrect or has expired/i);
  assert.equal(createCalls, 0);
});

test('unverified Google-profile phone and privileged accounts are never auto-linked', async () => {
  stored = customer({ phoneVerified: false, email: 'customer@example.test', firebaseUid: 'firebase-id' });
  assert.equal((await post('/api/auth/otp/verify', { phone: stored.phone, otp: '654321' })).status, 409);
  stored = customer({ role: 'admin' });
  assert.equal((await post('/api/auth/otp/verify', { phone: stored.phone, otp: '654321' })).status, 403);
  assert.equal(createCalls, 0);
});

test('a concurrent unique conflict resolves to the already-created verified customer', async () => {
  const concurrent = customer();
  User.createByPhone = async () => {
    stored = concurrent;
    throw Object.assign(new Error('duplicate'), { code: '23505' });
  };
  const response = await post('/api/auth/otp/verify', { phone: concurrent.phone, otp: '654321' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, concurrent.id);
  assert.equal(lastLoginCalls, 1);
});

test('MSG91 failures are sanitized for customers', async () => {
  sendFailure = Object.assign(new Error('provider response containing private details'), {
    status: 503, code: 'OTP_PROVIDER_UNAVAILABLE'
  });
  const response = await post('/api/auth/otp/send', { phone: '9876543210' });
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /private details|test-auth-key/);
});

test('OTP resend cooldown and verification attempt limits are enforced by the real auth route', async () => {
  const router = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  app.use(errorHandler);
  const limitedServer = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const url = `http://127.0.0.1:${limitedServer.address().port}/api/auth/otp/send`;
    const request = () => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9765432109' })
    });
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
    assert.equal(sentPhones.filter(phone => phone === '+919765432109').length, 1);

    const verify = () => fetch(`http://127.0.0.1:${limitedServer.address().port}/api/auth/otp/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9654321098', otp: '000000' })
    });
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await verify()).status, 401);
    assert.equal((await verify()).status, 429);
  } finally {
    await new Promise(resolve => limitedServer.close(resolve));
  }
});

test('MSG91 adapter uses documented backend endpoints and headers without real network calls', async t => {
  Object.assign(msg91, originalProvider);
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ type: 'success' }) };
  });
  await msg91.sendOtp('+919876543210');
  assert.equal(await msg91.verifyOtp('+919876543210', '654321'), true);
  assert.match(requests[0].url, /^https:\/\/api\.msg91\.com\/api\/v5\/otp\?/);
  assert.match(requests[1].url, /^https:\/\/control\.msg91\.com\/api\/v5\/otp\/verify\?/);
  assert.equal(requests[0].options.headers.authkey, process.env.MSG91_AUTH_KEY);
  assert.doesNotMatch(requests[0].url, new RegExp(process.env.MSG91_AUTH_KEY));
});
