const multer = require('multer');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const asyncHandler = require('./asyncHandler');
const allowed = new Set(['image/jpeg','image/png','image/webp','image/avif']);
const parser = multer({ storage: multer.diskStorage({ destination: (req, _file, cb) => cb(null, req.defectUploadDirectory),
  filename: (_req, _file, cb) => cb(null, randomUUID()) }),
  limits: { files: 2, fields: 0, parts: 2, fileSize: 5 * 1024 * 1024, headerPairs: 100 },
  fileFilter: (_req, file, cb) => cb(allowed.has(file.mimetype) ? null : Object.assign(new Error('Choose a JPG, PNG, WebP or AVIF photo.'), { status: 400 }), allowed.has(file.mimetype)) });
module.exports = asyncHandler(async (req, res, next) => {
  req.defectUploadDirectory = await mkdtemp(path.join(tmpdir(), 'monkhagen-defect-'));
  const directory = req.defectUploadDirectory;
  const cleanup = () => {
    if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('monkhagen-defect-')) {
      void rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  };
  res.once('finish', cleanup); res.once('close', cleanup);
  parser.array('images', 2)(req, res, next);
});
