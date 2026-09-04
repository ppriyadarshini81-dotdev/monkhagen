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
    return res.status(400).json({ message: 'Image exceeds the 5 MB limit.' });
  }

  console.error('Request failed:', {
    name: err.name || 'Error',
    code: err.code || null,
    message: err.message || 'Server error.'
  });
  res.status(err.status || 500).json({ message: err.message || 'Server error.' });
}

module.exports = { notFound, errorHandler };
