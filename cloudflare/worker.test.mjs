import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import worker from './worker.mjs';

const frontend = 'https://monkhagen.example';
const upstreamOrigin = 'https://monkhagen-api.onrender.com';
const env = {
  RENDER_API_ORIGIN: upstreamOrigin,
  ASSETS: { fetch: async () => new Response('angular', { headers: { 'Content-Type': 'text/html' } }) }
};
function request(path, init = {}) { return new Request(frontend + path, init); }
function mockFetch(t, handler) { t.mock.method(globalThis, 'fetch', handler); }

for (const path of ['/', '/products', '/account/profile', '/api-other', '/main.js']) {
  test(`non-API path uses static assets: ${path}`, async t => {
    mockFetch(t, () => { throw new Error('Must not call Render'); });
    assert.equal(await (await worker.fetch(request(path), env)).text(), 'angular');
  });
}

test('deployment config uses browser assets, SPA fallback and API-first routing', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'monkhagen');
  assert.equal(config.assets.directory, './dist/clothing-ui/browser');
  assert.equal(config.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(config.assets.run_worker_first, ['/api', '/api/*']);
  assert.equal(config.vars.RENDER_API_ORIGIN, upstreamOrigin);
});

test('static CSP preserves existing Firebase/Razorpay popup compatibility', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const header of vercel.headers[0].headers) {
    assert.ok(headers.includes(`${header.key}: ${header.value}`), header.key);
  }
});

test('fixed Render target preserves query, bearer token and cache validators', async t => {
  mockFetch(t, async (req, options) => {
    assert.equal(req.url, upstreamOrigin + '/api/media?url=https%3A%2F%2Fexample.com%2Fa.webp');
    assert.equal(req.headers.get('Authorization'), 'Bearer mock-session');
    assert.equal(req.headers.get('If-None-Match'), 'image-tag');
    assert.equal(req.headers.get('Range'), 'bytes=0-20');
    for (const header of ['Origin', 'Cookie', 'Referer', 'X-Forwarded-For', 'CF-Connecting-IP']) {
      assert.equal(req.headers.get(header), null);
    }
    assert.equal(req.redirect, 'manual');
    assert.equal(options.cf.cacheTtl, 0);
    return Response.json({ ok: true });
  });
  const response = await worker.fetch(request('/api/media?url=https%3A%2F%2Fexample.com%2Fa.webp', {
    headers: { Authorization: 'Bearer mock-session', Origin: frontend, Cookie: 'session=mock',
      Referer: frontend + '/cart', 'X-Forwarded-For': '1.2.3.4', 'CF-Connecting-IP': '1.2.3.4',
      'If-None-Match': 'image-tag', Range: 'bytes=0-20' }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`${method} preserves body and content type without caching`, async t => {
    const body = '{"quantity":2,"note":"unchanged"}';
    mockFetch(t, async req => {
      assert.equal(req.method, method);
      assert.equal(req.headers.get('Content-Type'), 'application/json');
      assert.equal(await req.text(), body);
      return Response.json({ accepted: true }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    });
    const response = await worker.fetch(request('/api/cart', {
      method, body, headers: { 'Content-Type': 'application/json', Origin: frontend }
    }), env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
}

test('multipart upload bytes are not parsed or reserialized', async t => {
  const body = '--mock-boundary\r\nContent-Disposition: form-data; name="file"; filename="a.webp"\r\n\r\nbytes\r\n--mock-boundary--\r\n';
  mockFetch(t, async req => {
    assert.equal(req.headers.get('Content-Type'), 'multipart/form-data; boundary=mock-boundary');
    assert.equal(await req.text(), body);
    return Response.json({ ok: true });
  });
  assert.equal((await worker.fetch(request('/api/upload', {
    method: 'POST', body, headers: { 'Content-Type': 'multipart/form-data; boundary=mock-boundary' }
  }), env)).status, 200);
});

for (const headers of [{ Origin: 'https://hostile.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
  test(`rejects cross-origin browser access: ${JSON.stringify(headers)}`, async t => {
    mockFetch(t, () => { throw new Error('Must not forward'); });
    assert.equal((await worker.fetch(request('/api/products', { headers }), env)).status, 403);
  });
}

test('invalid upstream configuration fails closed', async t => {
  mockFetch(t, () => { throw new Error('Must not forward'); });
  assert.equal((await worker.fetch(request('/api'), { ...env, RENDER_API_ORIGIN: 'https://hostile.example' })).status, 503);
});

test('public media retains cache validators, range status and sandbox security', async t => {
  mockFetch(t, async () => new Response('image bytes', {
    status: 206,
    headers: { 'Content-Type': 'image/webp', ETag: 'image-tag', 'Cache-Control': 'public, max-age=86400',
      'Content-Range': 'bytes 0-10/20', 'Content-Security-Policy': 'sandbox' }
  }));
  const response = await worker.fetch(request('/api/media?url=public-image'), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('ETag'), 'image-tag');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-10/20');
  assert.equal(response.headers.get('Content-Security-Policy'), 'sandbox');
});

test('304 response is not treated as a redirect', async t => {
  mockFetch(t, async () => new Response(null, { status: 304, headers: { ETag: 'image-tag' } }));
  assert.equal((await worker.fetch(request('/api/media'), env)).status, 304);
});

test('backend JSON errors and status remain unchanged', async t => {
  mockFetch(t, async () => Response.json({ error: 'Authentication required' }, { status: 401 }));
  const response = await worker.fetch(request('/api/account', { headers: { Authorization: 'Bearer mock-session' } }), env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const mode of ['network', 'redirect', 'html']) {
  test(`${mode} failure is sanitized and not cached`, async t => {
    mockFetch(t, async () => {
      if (mode === 'network') throw new Error('internal host details');
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://hostile.example' } });
      return new Response('internal server details', { headers: { 'Content-Type': 'text/html' } });
    });
    const response = await worker.fetch(request('/api/products'), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'API temporarily unavailable. Please try again.' });
  });
}
