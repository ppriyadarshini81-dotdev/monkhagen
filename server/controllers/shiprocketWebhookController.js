const asyncHandler = require('../middleware/asyncHandler');
const returns = require('../services/returnService');

exports.tracking = asyncHandler(async (req, res) => {
  const result = await returns.processShiprocketWebhook(req.body, req.headers);
  res.json({ received: true, duplicate: result.duplicate, ignored: result.ignored });
});
