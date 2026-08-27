const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required.' });
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }
  res.json({ token: signToken(user), user: user.toJSON() });
});

// GET /api/auth/me
exports.me = asyncHandler(async (req, res) => {
  res.json(req.user.toJSON());
});
