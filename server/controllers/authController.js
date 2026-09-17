const asyncHandler = require('../middleware/asyncHandler');

// GET /api/auth/me
exports.me = asyncHandler(async (req, res) => {
  res.json(req.user.toJSON());
});
