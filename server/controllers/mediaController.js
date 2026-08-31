const { Readable } = require('stream');
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

  if (source.protocol !== 'https:' || source.hostname !== R2_HOST) {
    return res.status(403).json({ message: 'Image host is not allowed.' });
  }

  const requestHeaders = {};
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
      redirect: 'error'
    });
  } catch {
    return res.status(502).json({ message: 'Image could not be loaded.' });
  }

  res.setHeader('Cache-Control', CACHE_CONTROL);

  if (upstream.status === 304) {
    return res.status(304).end();
  }
  if (!upstream.ok || !upstream.body) {
    return res.status(upstream.status === 404 ? 404 : 502).json({
      message: upstream.status === 404 ? 'Image not found.' : 'Image could not be loaded.'
    });
  }

  for (const header of ['content-type', 'content-length', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  Readable.fromWeb(upstream.body)
    .on('error', (error) => {
      if (!res.headersSent) {
        res.status(502).json({ message: 'Image could not be loaded.' });
      } else {
        res.destroy(error);
      }
    })
    .pipe(res);
});
