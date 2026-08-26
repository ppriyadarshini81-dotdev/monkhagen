const router = require('express').Router();
const ctrl = require('../controllers/uploadController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Up to 8 files per request, field name "images".
router.post('/', authenticate, requireAdmin, ctrl.upload.array('images', 8), ctrl.uploadImages);

module.exports = router;
