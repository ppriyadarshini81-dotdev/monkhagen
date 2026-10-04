const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../config/db');
const User = require('../models/User');

const originalConnect = pool.connect;
const originalFindById = User.findById;
afterEach(() => {
  pool.connect = originalConnect;
  User.findById = originalFindById;
});

function row(overrides = {}) {
  return {
    id: 'phone-user', role_name: 'customer', name: 'User', email: null,
    phone: '9876543210', phone_verified: true, email_verified: false,
    firebase_uid: null, google_uid: null, is_active: true, session_version: 0,
    ...overrides
  };
}

function databaseFixture(target = null, { sourceCart = null, targetCart = null, targetDefault = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/WHERE u\.id = \$1 FOR UPDATE OF u/.test(sql)) return { rows: [row()] };
      if (/WHERE u\.firebase_uid = \$1 OR LOWER\(u\.email\)/.test(sql)) return { rows: target ? [target] : [] };
      if (/COUNT\(\*\)::integer AS count/.test(sql)) return { rows: target ? [
        { user_id: 'phone-user', count: 1 }, { user_id: target.id, count: 2 }
      ] : [] };
      if (/FROM carts/.test(sql) && /status = 'active'/.test(sql)) {
        return { rows: [sourceCart, targetCart].filter(Boolean) };
      }
      if (/SELECT 1 FROM customer_addresses/.test(sql)) return { rows: targetDefault ? [{ '?column?': 1 }] : [] };
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  pool.connect = async () => client;
  User.findById = async id => ({ id, name: target ? 'Existing Name' : 'Google Name', email: 'customer@example.com',
    phone: '9876543210', role: 'customer', firebaseUid: 'google-uid', sessionVersion: 0,
    toJSON() { return { id: this.id, name: this.name }; } });
  return calls;
}

test('verified Google email upgrades a phone-only account when no prior account exists', async () => {
  const calls = databaseFixture();
  const linked = await User.linkVerifiedGoogleAccount('phone-user', {
    uid: 'google-uid', email: 'customer@example.com', name: 'Google Name', picture: 'photo'
  });
  assert.equal(linked.id, 'phone-user');
  assert.ok(calls.some(call => /SET email = \$1, firebase_uid = \$2/.test(call.sql) &&
    call.params[0] === 'customer@example.com' && call.params[1] === 'google-uid'));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.doesNotMatch(calls.map(call => call.sql).join('\n'), /DELETE FROM users/);
});

test('matching existing Google account receives owned customer data before temporary phone identity is removed', async () => {
  const target = row({ id: 'google-user', name: 'Existing Name', email: 'customer@example.com',
    firebase_uid: 'google-uid', phone: null, phone_verified: false, email_verified: true });
  const calls = databaseFixture(target, {
    sourceCart: { id: 'source-cart', user_id: 'phone-user' },
    targetCart: { id: 'target-cart', user_id: 'google-user' },
    targetDefault: true
  });
  const linked = await User.linkVerifiedGoogleAccount('phone-user', {
    uid: 'google-uid', email: 'customer@example.com', name: 'Google Name', picture: 'photo'
  });
  assert.equal(linked.id, 'google-user');
  const sql = calls.map(call => call.sql).join('\n');
  for (const table of ['customer_addresses', 'orders', 'return_requests', 'credit_transactions',
    'analytics_sessions', 'analytics_events']) {
    assert.match(sql, new RegExp(`UPDATE ${table}`));
  }
  assert.match(sql, /INSERT INTO cart_items/);
  assert.match(sql, /DELETE FROM users WHERE id = \$1/);
  assert.ok(calls.some(call => /SET phone = \$1, phone_verified = TRUE/.test(call.sql) &&
    call.params[0] === '9876543210' && call.params.at(-1) === 'google-user'));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});
