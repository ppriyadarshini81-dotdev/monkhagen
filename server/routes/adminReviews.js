const router = require('express').Router();
const ctrl = require('../controllers/adminReviewController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validation = require('../middleware/validation');

validation.params(router);
router.use(authenticate, requireAdmin);
router.get('/', ctrl.list);
router.patch('/:reviewId/moderation', ctrl.moderate);

module.exports = router;
