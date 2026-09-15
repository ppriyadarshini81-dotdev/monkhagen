const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const googleCtrl = require('../controllers/googleAuthController');
const { authenticate } = require('../middleware/auth');
const { legacyOtpEnabled } = require('../config/security');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please try again later.' }
});

router.post('/login', authLimiter, ctrl.login);
router.get('/me', authenticate, ctrl.me);

// Google / Firebase customer login
router.post('/google', authLimiter, googleCtrl.googleLogin);

// Deprecated OTP routes are available only for deliberately configured legacy clients.
if (legacyOtpEnabled()) {
  const otpCtrl = require('../controllers/otpController');
  router.post('/send-otp', authLimiter, otpCtrl.sendOtp);
  router.post('/verify-otp', authLimiter, otpCtrl.verifyOtp);
}

module.exports = router;
