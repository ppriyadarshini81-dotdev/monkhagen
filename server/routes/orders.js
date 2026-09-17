const router = require('express').Router();
const ctrl = require('../controllers/orderController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { checkoutLimiter } = require('../middleware/rateLimit');
require('../middleware/validation').params(router);

router.post('/', authenticate, checkoutLimiter, ctrl.create);
router.get('/mine', authenticate, ctrl.mine);
router.get('/', authenticate, requireAdmin, ctrl.all);
router.put('/:id/status', authenticate, requireAdmin, ctrl.updateStatus);

module.exports = router;
