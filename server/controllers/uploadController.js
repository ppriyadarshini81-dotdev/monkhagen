const multer = require('multer');
const { uploadFile, ALLOWED_MIME, MAX_IMAGE_SIZE } = require('../config/r2');
const asyncHandler = require('../middleware/asyncHandler');

// Multer stores files in memory; R2 upload happens in the handler
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: jpg, png, webp, avif, mp4`));
    }
  }
});

exports.upload = upload;

// POST /api/upload?folder=products|banners|logos|videos
exports.uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No files received.' });
  }

  const allowed = ['products', 'banners', 'logos', 'videos'];
  const folder = allowed.includes(req.query.folder) ? req.query.folder : 'products';

  try {
    const results = await Promise.all(
      req.files.map((f) => uploadFile(f.buffer, f.mimetype, folder))
    );
    res.status(201).json({
      urls: results.map((r) => r.url),
      keys: results.map((r) => r.key)
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Upload failed.' });
  }
});
