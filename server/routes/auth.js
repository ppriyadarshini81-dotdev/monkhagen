const router = require('express').Router();
const { createLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/authController');
const firebaseCtrl = require('../controllers/firebaseAuthController');
const otpCtrl = require('../controllers/otpController');
const { authenticate } = require('../middleware/auth');
const { phoneRateLimitKey } = require('../services/phoneNumber');

const authLimiter = createLimiter('authentication', { windowMs: 15 * 60000, limit: 10 });

router.get('/me', authenticate, ctrl.me);
router.post('/logout', authenticate, authLimiter, require('../middleware/asyncHandler')(async (req, res) => {
  await require('../services/analyticsService').recordServerEvent(req, 'LOGOUT', {
    dedupeKey: `logout:${req.user.id}:${Date.now()}`
  });
  await require('../models/User').revokeSessions(req.user.id);
  require('../services/firebaseSession').invalidate(req.user.firebaseUid);
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
}));

// All Firebase customer providers (Google and email/password) use the same verified-token flow.
router.post('/firebase', authLimiter, firebaseCtrl.firebaseLogin);
// Compatibility for clients deployed before the provider-neutral endpoint.
router.post('/google', authLimiter, firebaseCtrl.firebaseLogin);
router.post('/link-google', authenticate, authLimiter, firebaseCtrl.linkGoogleAccount);

const phoneKey = scope => req => `${scope}:${phoneRateLimitKey(req.body?.phone)}`;
const otpSendIpLimiter = createLimiter('otp-send-ip', { windowMs: 15 * 60000, limit: 5 });
const otpSendCooldown = createLimiter('otp-send-phone-cooldown', { windowMs: 45 * 1000, limit: 1, keyGenerator: phoneKey('cooldown') });
const otpSendPhoneLimiter = createLimiter('otp-send-phone', { windowMs: 15 * 60000, limit: 3, keyGenerator: phoneKey('window') });
const otpSendDailyLimiter = createLimiter('otp-send-phone-daily', { windowMs: 24 * 60 * 60000, limit: 10, keyGenerator: phoneKey('daily') });
const otpVerifyIpLimiter = createLimiter('otp-verify-ip', { windowMs: 15 * 60000, limit: 20 });
const otpVerifyPhoneLimiter = createLimiter('otp-verify-phone', { windowMs: 15 * 60000, limit: 5, keyGenerator: phoneKey('attempts') });

router.post('/otp/send', otpSendIpLimiter, otpSendCooldown, otpSendPhoneLimiter, otpSendDailyLimiter, otpCtrl.sendOtp);
router.post('/otp/verify', otpVerifyIpLimiter, otpVerifyPhoneLimiter, otpCtrl.verifyOtp);

module.exports = router;
