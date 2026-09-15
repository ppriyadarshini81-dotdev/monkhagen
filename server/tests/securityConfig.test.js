const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allowedCorsOrigins,
  developmentOtpCode,
  jwtSecret,
  legacyOtpEnabled
} = require('../config/security');

test('production requires an explicit strong JWT secret', () => {
  assert.throws(() => jwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(
    () => jwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short' }),
    /at least 32 characters/
  );
  assert.equal(
    jwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a-secure-production-secret-over-32-chars' }),
    'a-secure-production-secret-over-32-chars'
  );
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

test('legacy OTP and its fixed development code are opt-in', () => {
  assert.equal(legacyOtpEnabled({}), false);
  assert.equal(legacyOtpEnabled({ ENABLE_LEGACY_OTP: 'true' }), true);
  assert.equal(developmentOtpCode({ DEV_OTP_CODE: '123456' }), '123456');
  assert.equal(developmentOtpCode({ DEV_OTP_CODE: '1234567' }), null);
  assert.equal(
    developmentOtpCode({ NODE_ENV: 'production', DEV_OTP_CODE: '123456' }),
    null
  );
});
