// Centralised error handler — normalises PostgreSQL/pg errors into clean JSON.
function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
}

function errorHandler(err, req, res, _next) {
  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }

  // PostgreSQL not-null / check constraint
  if (err.code === '23502' || err.code === '23514') {
    return res.status(400).json({ message: err.detail || 'Invalid value.' });
  }

  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'File exceeds the 200 MB upload limit.' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ message: 'A maximum of 8 files may be uploaded at once.' });
  }

  console.error('Request failed:', {
    name: err.name || 'Error',
    code: err.code || null,
    message: err.message || 'Server error.'
  });
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500
    ? err.status
    : 500;
  res.status(status).json({
    message: status === 500 ? 'Something went wrong. Please try again.' : err.message
  });
}

module.exports = { notFound, errorHandler };
