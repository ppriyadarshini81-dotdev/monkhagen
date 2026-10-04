const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const {
  adminGoogleEmail,
  allowedCorsOrigins,
  jwtSecret
} = require('../config/security');

test('administrator identity requires explicit configuration without an implicit fallback', () => {
  for (const ADMIN_GOOGLE_EMAIL of [undefined, '', '   ', 'not-an-email', 'one@example.com,two@example.com']) {
    assert.throws(() => adminGoogleEmail({ ADMIN_GOOGLE_EMAIL }), /ADMIN_GOOGLE_EMAIL/);
  }
  assert.equal(adminGoogleEmail({ ADMIN_GOOGLE_EMAIL: '  Administrator@Example.com  ' }), 'administrator@example.com');
});

test('every environment requires an explicit strong JWT secret without a fallback', () => {
  const secret = randomBytes(64).toString('hex');
  for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
    assert.throws(() => jwtSecret({ NODE_ENV }), /JWT_SECRET/);
    assert.throws(() => jwtSecret({ NODE_ENV, JWT_SECRET: '   ' }), /JWT_SECRET/);
    assert.throws(() => jwtSecret({ NODE_ENV, JWT_SECRET: 'x'.repeat(31) }), /at least 32 characters/);
    assert.equal(jwtSecret({ NODE_ENV, JWT_SECRET: secret }), secret);
    assert.equal(jwtSecret({ NODE_ENV, JWT_SECRET: `  ${secret}  ` }), secret);
  }
});

test('CORS is localhost-only in development and explicit in production', () => {
  assert.deepEqual(allowedCorsOrigins({}), [
    'http://localhost:4200',
    'http://127.0.0.1:4200'
  ]);
  assert.throws(() => allowedCorsOrigins({ NODE_ENV: 'production' }), /CORS_ORIGINS/);
  assert.deepEqual(
    allowedCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://monkhagen.com, https://www.monkhagen.com' }),
    ['https://monkhagen.com', 'https://www.monkhagen.com']
  );
});
