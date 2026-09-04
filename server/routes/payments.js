const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.post('/create-order', ctrl.createOrder);
router.post('/verify', ctrl.verify);

module.exports = router;
