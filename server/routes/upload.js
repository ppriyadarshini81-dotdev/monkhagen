const router = require('express').Router();
const ctrl = require('../controllers/uploadController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Up to 8 files per request, field name "images".
router.post('/', authenticate, requireAdmin,
  require('../middleware/rateLimit').createLimiter('uploads', { limit: 5, windowMs: 15 * 60000, authenticated: true }),
  ctrl.receiveUploads, ctrl.uploadImages);

module.exports = router;
