const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/homepageMediaController');

router.get('/', controller.get);
router.put('/', authenticate, requireAdmin, controller.save);
module.exports = router;
