const router = require('express').Router();
const ctrl = require('../controllers/uploadController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

// Up to 8 images per request, field name "images".
router.post('/', authenticate, requireAdmin, upload.array('images', 8), ctrl.uploadImages);

module.exports = router;
