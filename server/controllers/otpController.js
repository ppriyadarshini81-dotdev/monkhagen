const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const analytics = require('../services/analyticsService');
const msg91 = require('../services/msg91OtpService');
const { normalizeIndianMobile, toE164Indian } = require('../services/phoneNumber');

function invalidPhone(res) {
  return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
}

function permittedOtpCustomer(user, res) {
  if (!user.isActive) {
    res.status(403).json({ message: 'This account is unavailable. Contact support.' });
    return false;
  }
  if (['admin', 'super_admin'].includes(user.role)) {
    res.status(403).json({ message: 'Use the administrator Google sign-in method for this account.' });
    return false;
  }
  if (!user.phoneVerified) {
    res.status(409).json({
      message: 'This mobile number is attached to another account but is not verified. Sign in with Google or contact support to link it safely.'
    });
    return false;
  }
  return true;
}

// POST /api/auth/otp/send
exports.sendOtp = asyncHandler(async (req, res) => {
  const phone = normalizeIndianMobile(req.body?.phone);
  if (!phone) return invalidPhone(res);
  await msg91.sendOtp(toE164Indian(phone));
  res.set('Cache-Control', 'no-store');
  res.json({ message: 'Verification code sent.' });
});

// POST /api/auth/otp/verify
exports.verifyOtp = asyncHandler(async (req, res) => {
  const phone = normalizeIndianMobile(req.body?.phone);
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!phone) return invalidPhone(res);
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: 'Enter the 6-digit verification code.' });
  }

  if (!await msg91.verifyOtp(toE164Indian(phone), otp)) {
    return res.status(401).json({ message: 'The verification code is incorrect or has expired.' });
  }

  let user = await User.findByPhone(phone);
  let created = false;
  if (user) {
    if (!permittedOtpCustomer(user, res)) return;
    await User.updateLastLogin(user.id);
  } else {
    try {
      user = await User.createByPhone({ phone, name: 'User' });
      created = true;
    } catch (error) {
      if (error.code !== '23505') throw error;
      user = await User.findByPhone(phone);
      if (!user) throw error;
      if (!permittedOtpCustomer(user, res)) return;
      await User.updateLastLogin(user.id);
    }
  }

  res.set('Cache-Control', 'no-store');
  await analytics.recordServerEvent(req, created ? 'SIGNUP' : 'LOGIN', {
    userId: user.id,
    dedupeKey: `auth:${created ? 'signup' : 'login'}:phone:${user.id}:${Date.now()}`
  });
  res.json({ token: signToken(user), user: user.toJSON(), isNewUser: created });
});
