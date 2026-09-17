const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const nodemailer = require('nodemailer');
const modulePath = require.resolve('../config/mailer');
const originalCreateTransport = nodemailer.createTransport;
const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS'];
const originalEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  nodemailer.createTransport = originalCreateTransport;
  delete require.cache[modulePath];
  for (const key of keys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});
function configuration(port, secure) {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'test@example.com';
  process.env.SMTP_PASS = randomBytes(32).toString('hex');
  process.env.SMTP_PORT = String(port);
  if (secure === undefined) delete process.env.SMTP_SECURE;
  else process.env.SMTP_SECURE = String(secure);
  let options;
  nodemailer.createTransport = value => { options = value; return {}; };
  require('../config/mailer').getTransporter();
  return options;
}
test('submission SMTP requires STARTTLS and certificate verification before sending credentials', () => {
  const options = configuration(587);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.deepEqual(options.tls, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  assert.equal(options.ignoreTLS, undefined);
  assert.equal(options.opportunisticTLS, undefined);
});
test('implicit TLS SMTP retains encrypted port 465 configuration and verifies certificates', () => {
  const options = configuration(465);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, false);
  assert.equal(options.tls.rejectUnauthorized, true);
});
test('explicitly disabling implicit SMTP TLS still requires a STARTTLS upgrade', () => {
  const options = configuration(587, false);
  assert.equal(options.requireTLS, true);
});
test('missing SMTP credentials fail safely without creating a transport', () => {
  delete process.env.SMTP_PASS;
  let called = false;
  nodemailer.createTransport = () => { called = true; };
  assert.throws(() => require('../config/mailer').getTransporter(), /Email service is not configured/);
  assert.equal(called, false);
});
