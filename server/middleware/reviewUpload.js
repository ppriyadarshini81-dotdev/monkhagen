const multer = require('multer');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const asyncHandler = require('./asyncHandler');

const REVIEW_IMAGE_LIMIT = 5 * 1024 * 1024;
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const parser = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => callback(null, req.reviewUploadDirectory),
    filename: (_req, _file, callback) => callback(null, randomUUID())
  }),
  limits: { fileSize: REVIEW_IMAGE_LIMIT, files: 5, fields: 5, parts: 10, fieldNameSize: 50, fieldSize: 3000, headerPairs: 100 },
  fileFilter: (_req, file, callback) => callback(
    allowed.has(file.mimetype) ? null : Object.assign(new Error('Review photos must be JPG, PNG, WebP or AVIF images.'), { status: 400 }),
    allowed.has(file.mimetype)
  )
});

module.exports = asyncHandler(async (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  req.reviewUploadDirectory = await mkdtemp(path.join(tmpdir(), 'monkhagen-review-'));
  const directory = req.reviewUploadDirectory;
  const cleanup = () => {
    if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('monkhagen-review-')) {
      void rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);
  parser.array('images', 5)(req, res, next);
});
