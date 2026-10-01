const asyncHandler = require('../middleware/asyncHandler');
const returns = require('../services/returnService');
const shipping = require('../services/shippingWebhookService');

exports.tracking = asyncHandler(async (req, res) => {
  const reverse = await returns.processShiprocketWebhook(req.body, req.headers);
  const forward = await shipping.processForwardWebhook(req.body, req.headers);
  res.json({
    received: true,
    duplicate: Boolean(reverse.duplicate || forward.duplicate),
    ignored: Boolean(reverse.ignored && forward.ignored)
  });
});
