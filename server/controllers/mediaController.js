const { Readable, Transform } = require('stream');
const { pipeline } = require('node:stream/promises');
const asyncHandler = require('../middleware/asyncHandler');

const R2_HOST = 'pub-72df2dffccc643c59aebafe55e835d7b.r2.dev';
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

exports.proxyImage = asyncHandler(async (req, res) => {
  if (typeof req.query.url !== 'string') {
    return res.status(400).json({ message: 'Image URL is required.' });
  }

  let source;
  try {
    source = new URL(req.query.url);
  } catch {
    return res.status(400).json({ message: 'Invalid image URL.' });
  }

  if (source.protocol !== 'https:' || source.hostname !== R2_HOST || source.username || source.password || (source.port && source.port !== '443')) {
    return res.status(403).json({ message: 'Image host is not allowed.' });
  }

  const requestHeaders = {};
  for (const name of ['if-none-match','if-modified-since']) {
    if (req.headers[name] && (typeof req.headers[name] !== 'string' || req.headers[name].length > 1024)) return res.status(400).json({ message: 'Invalid cache validator.' });
  }
  if (req.headers['if-none-match']) {
    requestHeaders['if-none-match'] = req.headers['if-none-match'];
  }
  if (req.headers['if-modified-since']) {
    requestHeaders['if-modified-since'] = req.headers['if-modified-since'];
  }

  let upstream;
  try {
    upstream = await fetch(source, {
      headers: requestHeaders,
      redirect: 'error', signal: AbortSignal.timeout(20000)
    });
  } catch {
    return res.status(502).json({ message: 'Image could not be loaded.' });
  }

  res.setHeader('Cache-Control', CACHE_CONTROL);

  if (upstream.status === 304) {
    return res.status(304).end();
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return res.status(upstream.status === 404 ? 404 : 502).json({
      message: upstream.status === 404 ? 'Image not found.' : 'Image could not be loaded.'
    });
  }
  const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const maximum = 20 * 1024 * 1024;
  if (!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(mime) || Number(upstream.headers.get('content-length') || 0) > maximum) {
    await upstream.body.cancel().catch(() => {});
    return res.status(502).json({ message: 'Unsupported or oversized image.' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");

  for (const header of ['content-type', 'content-length', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  let received = 0;
  const ceiling = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    callback(received > maximum ? new Error('Image size limit exceeded.') : null, received > maximum ? undefined : chunk);
  } });
  try { await pipeline(Readable.fromWeb(upstream.body), ceiling, res); }
  catch { if (!res.destroyed) res.destroy(); }
});
