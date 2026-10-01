const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminReturnController');
require('../middleware/validation').params(router);

router.use(authenticate, requireAdmin);
router.get('/', ctrl.list);
router.get('/:returnId', ctrl.get);
router.post('/:returnId/approve', ctrl.approve);
router.post('/:returnId/reject', ctrl.reject);
router.post('/:returnId/refund', ctrl.refund);
router.post('/:returnId/retry-creation', ctrl.retry);
module.exports = router;
