// Centralised error handler — normalises PostgreSQL/pg errors into clean JSON.
function notFound(req, res, next) {
  res.status(404).json({ message: 'Route not found.' });
}

function errorHandler(err, req, res, _next) {
  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }

  // PostgreSQL not-null / check constraint
  if (err.code === '23502' || err.code === '23514') {
    return res.status(400).json({ message: 'Invalid value.' });
  }
  if (err.code === '23503') return res.status(409).json({ message: 'This record is referenced or its related record is unavailable.' });
  if (err.code === '22P02' || err.code === '22003' || err.code === '22007' || err.code === '22008') return res.status(400).json({ message: 'Invalid request value.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON request.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request exceeds the permitted size.' });

  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File exceeds the permitted upload size.' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ message: 'A maximum of 8 files may be uploaded at once.' });
  }
  if (String(err.code || '').startsWith('LIMIT_')) return res.status(400).json({ message: 'Invalid multipart upload.' });

  console.error('Request failed:', {
    code: /^[A-Z0-9_:-]{1,80}$/.test(err.code || '') ? err.code : 'REQUEST_FAILED'
  });
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
    ? err.status
    : 500;
  res.status(status).json({
    message: status >= 500 ? 'The request could not be completed. Please try again.' :
      (!err.response && !err.config && typeof err.message === 'string' && err.message.length < 300 ? err.message : 'Invalid request.')
  });
}

module.exports = { notFound, errorHandler };
