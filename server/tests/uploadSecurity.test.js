const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mkdtemp, writeFile, rm, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const r2 = require('../config/r2');
const { errorHandler } = require('../middleware/error');
const controller = require('../controllers/uploadController');
const originalSend = r2.s3.send;
afterEach(() => { r2.s3.send = originalSend; });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLfkAAAAASUVORK5CYII=', 'base64');

test('uploads inspect bytes rather than trusting the declared MIME type', async () => {
  let calls = 0; r2.s3.send = async () => { calls++; };
  for (const [buffer, mime] of [[Buffer.from('<html><script>bad()</script></html>'), 'image/png'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'), 'image/png'],
    [PNG, 'image/jpeg']]) await assert.rejects(r2.uploadFile(buffer, mime), error => error.status === 400);
  assert.equal(calls, 0);
  const result = await r2.uploadFile(PNG, 'image/png'); assert.equal(calls, 1); assert.match(result.key, /^products\/[0-9a-f-]{36}\.png$/);
});
test('oversized and wrong-folder files are rejected and arbitrary keys/foreign URLs cannot be deleted', async () => {
  let calls = 0; r2.s3.send = async () => { calls++; };
  assert.throws(() => r2.validateUpload('image/png','image/png',r2.MAX_IMAGE_SIZE + 1,'products'), error => error.status === 413);
  assert.throws(() => r2.validateUpload('video/mp4','video/mp4',100,'products'), error => error.status === 400);
  for (const key of ['../other/private.txt','https://other.example/products/a.png','users/private.json','products/shared-imported.png']) await r2.deleteFile(key);
  assert.equal(calls, 0);
});

test('defect photos use the scoped order/product folder and generated names, with no traversal or video uploads', async () => {
  const folder = 'ReturnDefectiveItem/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001';
  const commands = []; r2.s3.send = async command => commands.push(command.input);
  const uploaded = await r2.uploadFile(PNG, 'image/png', folder);
  assert.ok(uploaded.key.startsWith(folder + '/'));
  assert.match(uploaded.key.slice(folder.length + 1), /^[0-9a-f-]{36}\.png$/);
  assert.throws(() => r2.validateUpload('image/png','image/png',PNG.length,folder + '/../other'));
  assert.throws(() => r2.validateUpload('video/mp4','video/mp4',100,folder));
  await r2.deleteFile(uploaded.key); assert.equal(commands.length, 2);
});
test('disk-backed upload streams only validated content using generated keys and explicit length', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'monkhagen-test-'));
  try {
    const file = path.join(directory, 'image'); await writeFile(file, PNG);
    let input; r2.s3.send = async command => { input = command.input; };
    await r2.uploadPath({ path: file, mimetype: 'image/png' });
    assert.equal(input.ContentType, 'image/png'); assert.equal(input.ContentLength, PNG.length); assert.equal(Buffer.isBuffer(input.Body), false);
    assert.equal(input.CacheControl, 'public, max-age=31536000, immutable');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('multipart transport rejects excessive files/fields and cleans temporary uploads', async () => {
  r2.s3.send = async () => {};
  const directories = [];
  const app = express(); app.use((req, res, next) => { res.on('finish', () => { if (req.uploadDirectory) directories.push(req.uploadDirectory); }); next(); });
  app.post('/', controller.receiveUploads, controller.uploadImages); app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    for (const count of [1,9]) {
      const form = new FormData(); for (let i = 0; i < count; i++) form.append('images', new Blob([PNG], { type: 'image/png' }), '../../unsafe-name.png');
      assert.equal((await fetch(url, { method: 'POST', body: form })).status, count === 1 ? 201 : 400);
    }
    const invalid = new FormData(); invalid.append('extra', 'field');
    assert.equal((await fetch(url, { method: 'POST', body: invalid })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
  for (const directory of directories) {
    // Cleanup is an async response listener; allow the OS to release handles.
    for (let i = 0; i < 20; i++) { try { await access(directory); await new Promise(resolve => setTimeout(resolve, 10)); } catch { break; } }
    await assert.rejects(access(directory));
  }
});
