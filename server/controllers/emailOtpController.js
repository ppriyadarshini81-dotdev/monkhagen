const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const otp = require('../services/emailOtpService');
function allowed(user) { return user.role === 'customer' && user.phone && user.phoneVerified; }
exports.send = asyncHandler(async (req, res) => {
  if (!allowed(req.user)) return res.status(403).json({ message: 'A verified mobile customer account is required.' });
  const result = await otp.send(req.user, req.body?.email);
  res.set('Cache-Control', 'no-store'); res.json({ message: 'Verification code sent to your email.', ...result });
});
exports.verify = asyncHandler(async (req, res) => {
  if (!allowed(req.user)) return res.status(403).json({ message: 'A verified mobile customer account is required.' });
  const email = await otp.verify(req.user, req.body?.email, req.body?.otp);
  const user = await User.linkVerifiedEmailAccount(req.user.id, email);
  res.set('Cache-Control', 'no-store'); res.json({ token: signToken(user), user: user.toJSON() });
});
