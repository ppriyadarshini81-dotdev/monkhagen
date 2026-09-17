const router = require('express').Router();
const { createLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/authController');
const firebaseCtrl = require('../controllers/firebaseAuthController');
const { authenticate } = require('../middleware/auth');
const { legacyOtpEnabled } = require('../config/security');

const authLimiter = createLimiter('authentication', { windowMs: 15 * 60000, limit: 10 });

router.get('/me', authenticate, ctrl.me);

// All Firebase customer providers (Google and email/password) use the same verified-token flow.
router.post('/firebase', authLimiter, firebaseCtrl.firebaseLogin);
// Compatibility for clients deployed before the provider-neutral endpoint.
router.post('/google', authLimiter, firebaseCtrl.firebaseLogin);

// Deprecated OTP routes are available only for deliberately configured legacy clients.
if (legacyOtpEnabled()) {
  const otpCtrl = require('../controllers/otpController');
  router.post('/send-otp', authLimiter, otpCtrl.sendOtp);
  router.post('/verify-otp', authLimiter, otpCtrl.verifyOtp);
}

module.exports = router;
