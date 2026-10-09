const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminReturnController');
require('../middleware/validation').params(router);

router.use(authenticate, requireAdmin);
router.post('/eligibility-overrides', ctrl.grantEligibilityOverride);
router.get('/eligibility-overrides', ctrl.eligibilityOverrideHistory);
router.get('/', ctrl.list);
router.get('/:returnId', ctrl.get);
router.post('/:returnId/approve', ctrl.approve);
router.post('/:returnId/reject', ctrl.reject);
router.post('/:returnId/refund', ctrl.refund);
router.get('/:returnId/refund-destination/reveal', ctrl.revealRefundDestination);
router.post('/:returnId/refund/start', ctrl.startCodRefund);
router.post('/:returnId/refund/fail', ctrl.failCodRefund);
router.post('/:returnId/refund/complete', ctrl.completeCodRefund);
router.post('/:returnId/retry-creation', ctrl.retry);
module.exports = router;
