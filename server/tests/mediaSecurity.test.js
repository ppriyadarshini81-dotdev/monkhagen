const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { proxyImage } = require('../controllers/mediaController');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const HOST = 'pub-72df2dffccc643c59aebafe55e835d7b.r2.dev';
async function serve(run) {
  const app = express(); app.get('/', proxyImage);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('media proxy refuses foreign, credentialed and nonstandard-port destinations before fetching', async () => {
  let calls = 0; global.fetch = async () => { calls++; throw new Error('No external calls permitted'); };
  await serve(async base => {
    for (const url of ['http://127.0.0.1/private', 'https://example.test/a.png', `https://user:password@${HOST}/a.png`, `https://${HOST}:8443/a.png`]) {
      assert.equal((await originalFetch(`${base}/?url=${encodeURIComponent(url)}`)).status, 403);
    }
    assert.equal(calls, 0);
  });
});
test('media proxy refuses active content and oversized responses, and never follows redirects', async () => {
  await serve(async base => {
    for (const [mime, length] of [['image/svg+xml', '10'], ['text/html', '10'], ['image/png', String(21 * 1024 * 1024)]]) {
      global.fetch = async (_url, options) => {
        assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
        return new Response('test', { headers: { 'content-type': mime, 'content-length': length } });
      };
      assert.equal((await originalFetch(`${base}/?url=${encodeURIComponent(`https://${HOST}/a.png`)}`)).status, 502);
    }
    global.fetch = async () => new Response('safe-image', { headers: { 'content-type': 'image/webp' } });
    const result = await originalFetch(`${base}/?url=${encodeURIComponent(`https://${HOST}/a.webp`)}`);
    assert.equal(result.status, 200); assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.match(result.headers.get('content-security-policy'), /sandbox/);
    assert.equal(await result.text(), 'safe-image');
  });
});
