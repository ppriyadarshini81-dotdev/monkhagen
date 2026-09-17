const multer = require('multer');
const { uploadPath, ALLOWED_MIME, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE } = require('../config/r2');
const asyncHandler = require('../middleware/asyncHandler');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Disk-backed multipart parsing avoids retaining entire uploads in memory.
const upload = multer({
  storage: multer.diskStorage({ destination: (req, _file, cb) => cb(null, req.uploadDirectory),
    filename: (_req, _file, cb) => cb(null, randomUUID()) }),
  // Separate image/video transport limits are rechecked after content detection.
  limits: { fileSize: MAX_IMAGE_SIZE, files: 8, fields: 0, parts: 8, fieldNameSize: 50, headerPairs: 100 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) && file.mimetype !== 'video/mp4') {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Only JPG, PNG, WebP and AVIF images are permitted here.'), { status: 400 }));
    }
  }
});

const videoUpload = multer({ storage: upload.storage,
  limits: { fileSize: MAX_VIDEO_SIZE, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, cb) => cb(file.mimetype === 'video/mp4' ? null : Object.assign(new Error('Only MP4 videos are permitted here.'), { status: 400 }), file.mimetype === 'video/mp4') });

exports.receiveUploads = asyncHandler(async (req, res, next) => {
  if (req.query.folder !== undefined && !['products','banners','logos','videos'].includes(req.query.folder)) {
    return res.status(400).json({ message: 'Invalid upload folder.' });
  }
  req.uploadDirectory = await mkdtemp(path.join(tmpdir(), 'monkhagen-upload-'));
  const directory = req.uploadDirectory;
  const cleanup = () => {
    if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('monkhagen-upload-')) {
      void rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);
  const handler = req.query.folder === 'videos' ? videoUpload.array('images', 1) : upload.array('images', 8);
  handler(req, res, next);
});

// POST /api/upload?folder=products|banners|logos|videos
exports.uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No files received.' });
  }

  const allowed = ['products', 'banners', 'logos', 'videos'];
  const folder = allowed.includes(req.query.folder) ? req.query.folder : 'products';

  try {
    const results = [];
    // Stream files sequentially from temporary disk, not eight large buffers.
    for (const file of req.files) results.push(await uploadPath(file, folder));
    res.status(201).json({
      urls: results.map((r) => r.url),
      keys: results.map((r) => r.key)
    });
  } catch (err) {
    throw err;
  }
});
