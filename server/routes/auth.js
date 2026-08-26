const router = require('express').Router();
const ctrl = require('../controllers/authController');
const googleCtrl = require('../controllers/googleAuthController');
const { authenticate } = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/me', authenticate, ctrl.me);

// Google / Firebase customer login
router.post('/google', googleCtrl.googleLogin);

// OTP routes — DEPRECATED: customer login now uses Google
// Kept for backward compatibility; will be removed in a future release.
const otpCtrl = require('../controllers/otpController');
router.post('/send-otp', otpCtrl.sendOtp);
router.post('/verify-otp', otpCtrl.verifyOtp);

module.exports = router;
