const { cloudinaryEnabled } = require('../config/cloudinary');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/upload — admin; expects multipart form field "images" (up to 8 files)
exports.uploadImages = asyncHandler(async (req, res) => {
  if (!cloudinaryEnabled) {
    return res.status(503).json({
      message:
        'Cloudinary is not configured. Add CLOUDINARY_* values to your .env to enable uploads.'
    });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No images received.' });
  }
  const urls = req.files.map((f) => f.path);
  res.status(201).json({ urls });
});
