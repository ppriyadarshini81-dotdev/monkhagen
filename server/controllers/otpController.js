const { pool } = require('../config/db');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { developmentOtpCode } = require('../config/security');

function otpUnavailable() {
  const error = new Error('OTP authentication provider is not configured.');
  error.status = 503;
  return error;
}

// Calls MSG91 when configured; local fallback requires an explicit fixed code.
async function msg91Send(phone) {
  const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID } = process.env;
  if (MSG91_AUTH_KEY && MSG91_TEMPLATE_ID) {
    const res = await fetch(
      `https://api.msg91.com/api/v5/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=91${phone}`,
      { method: 'POST', headers: { authkey: MSG91_AUTH_KEY } }
    );
    if (!res.ok) throw new Error('MSG91 send OTP failed.');
  } else if (developmentOtpCode()) {
    console.log(`[DEV OTP] requested for +91${phone}`);
  } else throw otpUnavailable();
}

async function msg91Verify(phone, otp) {
  const { MSG91_AUTH_KEY } = process.env;
  if (MSG91_AUTH_KEY) {
    const res = await fetch(
      `https://api.msg91.com/api/v5/otp/verify?mobile=91${phone}&otp=${otp}`,
      { headers: { authkey: MSG91_AUTH_KEY } }
    );
    const data = await res.json();
    return data.type === 'success';
  }
  const developmentCode = developmentOtpCode();
  if (!developmentCode) throw otpUnavailable();
  return String(otp) === developmentCode;
}

// POST /api/auth/send-otp
exports.sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ message: '10-digit mobile number is required.' });
  }
  await msg91Send(phone);
  res.json({ message: 'OTP sent successfully.' });
});

// POST /api/auth/verify-otp
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp, name } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ message: 'phone and otp are required.' });
  }
  const valid = await msg91Verify(phone, otp);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid or expired OTP.' });
  }

  let user = await User.findByPhone(phone);
  const isNewUser = !user;
  if (isNewUser) {
    user = await User.createByPhone({ phone, name: name?.trim() || `User${phone.slice(-4)}` });
  } else {
    await User.updateLastLogin(user.id);
  }

  res.json({ token: signToken(user), user: user.toJSON(), isNewUser });
});
