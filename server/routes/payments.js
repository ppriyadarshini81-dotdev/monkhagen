const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');
const { checkoutLimiter, verifyLimiter } = require('../middleware/rateLimit');
router.use(require('../middleware/validation').body('payment'));

router.use(authenticate);
router.post('/create-order', checkoutLimiter, ctrl.createOrder);
router.post('/verify', verifyLimiter, ctrl.verify);

module.exports = router;
