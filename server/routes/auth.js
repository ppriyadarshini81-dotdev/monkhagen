const router = require('express').Router();
const ctrl = require('../controllers/authController');
const otpCtrl = require('../controllers/otpController');
const { authenticate } = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/me', authenticate, ctrl.me);

// OTP / mobile login
router.post('/send-otp', otpCtrl.sendOtp);
router.post('/verify-otp', otpCtrl.verifyOtp);

module.exports = router;
