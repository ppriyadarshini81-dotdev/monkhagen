const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createShiprocketClient, getConfig } = require('../config/shiprocket');

const settings = () => ({ baseUrl: 'https://apiv2.shiprocket.in', email: 'api-user@example.test', password: 'test-secret', timeout: 30 });
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('concurrent requests share a server-side login; refresh near expiry', async () => {
  let time = Date.now();
  let logins = 0;
  const client = createShiprocketClient({ config: settings, now: () => time, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/auth/login')) {
      logins++;
      assert.deepEqual(JSON.parse(options.body), { email: 'api-user@example.test', password: 'test-secret' });
      return json({ token: `token-${logins}` });
    }
    assert.equal(options.headers.Authorization, `Bearer token-${logins}`);
    return json({ data: { available_courier_companies: [] } });
  } });
  const responses = await Promise.all(Array.from({ length: 6 }, () => client.request('/courier/serviceability/')));
  assert.equal(logins, 1);
  assert.ok(!JSON.stringify(responses).includes('token-'));
  time += 10 * 86400000 - 60000;
  await client.request('/courier/serviceability/');
  assert.equal(logins, 2);
});

test('uses an earlier JWT expiry when present', async () => {
  let time = Date.now();
  let logins = 0;
  const client = createShiprocketClient({ config: settings, now: () => time, fetchImpl: async url => {
    if (!url.pathname.endsWith('/auth/login')) return json({ ok: true });
    logins++;
    return json({ token: `x.${Buffer.from(JSON.stringify({ exp: Math.floor(time / 1000) + 3600 })).toString('base64url')}.x` });
  } });
  await client.request('/orders');
  time += 56 * 60000;
  await client.request('/orders');
  assert.equal(logins, 2);
});

test('401 triggers one login refresh; repeated 401 is sanitized', async () => {
  let logins = 0;
  let calls = 0;
  const client = createShiprocketClient({ config: settings, fetchImpl: async url => {
    if (url.pathname.endsWith('/auth/login')) return json({ token: `token-${++logins}` });
    calls++;
    return json({ token: 'must-not-leak', password: 'test-secret' }, 401);
  } });
  await assert.rejects(client.request('/orders'), error => {
    assert.equal(error.code, 'SHIPROCKET_AUTH_FAILED');
    assert.equal(error.status, 503);
    assert.ok(!JSON.stringify(error).includes('must-not-leak'));
    return true;
  });
  assert.equal(logins, 2);
  assert.equal(calls, 2);
});

test('failed login never exposes provider text, credentials, or tokens', async () => {
  const client = createShiprocketClient({ config: settings, fetchImpl: async () => json({ message: 'test-secret', token: 'private-token' }, 422) });
  await assert.rejects(client.request('/orders'), error => error.code === 'SHIPROCKET_AUTH_FAILED' && !error.message.includes('test-secret'));
});

test('mutation timeout is uncertain and is not automatically replayed', async () => {
  let mutations = 0;
  const client = createShiprocketClient({ config: settings, fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/auth/login')) return json({ token: 'private-token' });
    mutations++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('internal sensitive details'))));
  } });
  await assert.rejects(client.request('/orders/create/adhoc', { method: 'POST', body: {} }), error =>
    error.code === 'SHIPROCKET_TIMEOUT' && error.status === 504 && error.uncertain);
  assert.equal(mutations, 1);
});

test('malformed successful mutations remain uncertain', async () => {
  const client = createShiprocketClient({ config: settings, fetchImpl: async url => {
    if (url.pathname.endsWith('/auth/login')) return json({ token: 'private-token' });
    return { ok: true, status: 200, json: async () => { throw new Error('raw provider HTML'); } };
  } });
  await assert.rejects(client.request('/courier/assign/awb', { method: 'POST' }), error =>
    error.code === 'SHIPROCKET_INVALID_RESPONSE' && error.uncertain && !error.message.includes('HTML'));
});

test('timeouts cover response body consumption', async () => {
  const client = createShiprocketClient({ config: settings, fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/auth/login')) return json({ token: 'private-token' });
    return { ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('body timed out')));
    }) };
  } });
  await assert.rejects(client.request('/orders/create/adhoc', { method: 'POST', body: {} }), error =>
    error.code === 'SHIPROCKET_TIMEOUT' && error.status === 504 && error.uncertain);
});

test('rejects unsafe credential destinations and missing configuration', () => {
  assert.throws(() => getConfig({}), error => error.code === 'SHIPROCKET_NOT_CONFIGURED');
  for (const url of ['http://apiv2.shiprocket.in', 'https://example.test', 'https://user:pass@apiv2.shiprocket.in', 'https://apiv2.shiprocket.in/other']) {
    assert.throws(() => getConfig({ SHIPROCKET_EMAIL: 'x', SHIPROCKET_PASSWORD: 'y', SHIPROCKET_BASE_URL: url }));
  }
});
