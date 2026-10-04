const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const validation = require('../middleware/validation');
const { errorHandler, notFound } = require('../middleware/error');
const { configureSecurity } = require('../config/httpSecurity');

async function serve(app, run) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('query validation rejects nested/duplicate filters and bounds pagination before handlers', async () => {
  const app = express(); app.set('query parser', 'extended'); app.use(validation.requestShape); app.get('/', (_req, res) => res.json({ ok: true }));
  await serve(app, async base => {
    for (const query of ['search[a]=x','search=a&search=b','limit=101','page=0','featured=1',`search=${'a'.repeat(201)}`]) assert.equal((await fetch(`${base}/?${query}`)).status, 400);
    assert.equal((await fetch(`${base}/?search=tee&limit=50&page=1`)).status, 200);
  });
});
test('catalog bodies strictly validate prices, quantities, IDs, booleans and media schemes', async () => {
  const app = express(); app.use(express.json(), validation.requestShape, validation.body('product')); app.post('/', (_req, res) => res.json({ ok: true }));
  const valid = { name: 'Tee', categoryId: '10000000-0000-4000-8000-000000000001', basePrice: 100, variants: [{ size: 'M', color: 'Black', stock: 2 }] };
  await serve(app, async base => {
    const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const body of [[], { ...valid, basePrice: -1 }, { ...valid, basePrice: '100' }, { ...valid, basePrice: 0.001 },
      { ...valid, isActive: 'false' }, { ...valid, categoryId: 'bad' }, { ...valid, images: ['javascript:alert(1)'] },
      { ...valid, images: ['https://user:password@example.com/a.png'] },
      { ...valid, zoomImages: ['https://example.com/zoom.webp'] },
      { ...valid, images: ['https://example.com/a.webp'], zoomImages: ['javascript:alert(1)'] },
      { ...valid, variants: [{ size: 'M', color: 'Black', stock: -1 }] }]) assert.equal((await post(body)).status, 400);
    assert.equal((await post({ ...valid, images: ['https://example.com/a.webp', 'https://example.com/b.webp'],
      zoomImages: ['https://example.com/a-zoom.webp', null] })).status, 200);
    assert.equal((await post(valid)).status, 200);
  });
});
test('UUID route parameters are rejected without invoking application handlers', async () => {
  const app = express(), router = express.Router(); validation.params(router);
  let calls = 0;
  router.get('/records/:id', (_req, res) => { calls++; res.json({ ok: true }); });
  router.get('/returns/:returnId', (_req, res) => { calls++; res.json({ ok: true }); });
  app.use(router);
  await serve(app, async base => {
    assert.equal((await fetch(`${base}/records/not-a-uuid`)).status, 400); assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/returns/not-a-uuid`)).status, 400); assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/records/10000000-0000-4000-8000-000000000001`)).status, 200);
  });
});
test('production headers enforce CSP without unsafe script directives while allowing Firebase and Razorpay', async () => {
  const app = express(); configureSecurity(app, { NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'test-project' }); app.get('/', (_req, res) => res.send('ok'));
  await serve(app, async base => {
    const response = await fetch(base), csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/checkout.razorpay.com/);
    assert.ok(!csp.split(';').find(part => part.trim().startsWith('script-src ')).includes('unsafe'));
    assert.match(csp, /https:\/\/test-project.firebaseapp.com/); assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.ok(response.headers.get('strict-transport-security')); assert.equal(response.headers.get('x-powered-by'), null);
  });
});
test('development avoids HTTPS upgrade enforcement; proxy trust never defaults to arbitrary forwarded headers', async () => {
  const app = express(); configureSecurity(app, {}); app.get('/', (req, res) => res.json({ ip: req.ip }));
  await serve(app, async base => {
    const response = await fetch(base, { headers: { 'X-Forwarded-For': '8.8.8.8' } });
    assert.notEqual((await response.json()).ip, '8.8.8.8'); assert.equal(response.headers.get('strict-transport-security'), null);
    assert.ok(!response.headers.get('content-security-policy-report-only').includes('upgrade-insecure-requests'));
  });
  for (const TRUST_PROXY of ['true','1','0.0.0.0/0','::/0']) assert.throws(() => configureSecurity(express(), { TRUST_PROXY }));
});
test('database/body-parser errors never expose SQL details, request bodies or query-string secrets', async () => {
  const app = express(); app.get('/error/:code', (req, _res, next) => next(Object.assign(new Error('internal SQL or token'), { code: req.params.code, detail: 'private row data' })));
  app.use(notFound, errorHandler);
  await serve(app, async base => {
    for (const code of ['23502','23514','23503','22P02','22003','XX000']) {
      const response = await fetch(`${base}/error/${code}`), body = await response.text();
      assert.ok(!body.includes('private') && !body.includes('internal') && !body.includes('token'));
    }
    const body = await (await fetch(`${base}/missing?secret=do-not-echo`)).text(); assert.ok(!body.includes('do-not-echo'));
  });
});
