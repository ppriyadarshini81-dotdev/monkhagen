const asyncHandler = require('../middleware/asyncHandler');
const paymentService = require('../services/paymentService');

exports.createOrder = asyncHandler(async (req, res) => {
  const result = await paymentService.createPaymentOrder(req.user.id, {
    addressId: req.body.addressId,
    checkoutToken: req.body.checkoutToken
  });
  res.status(201).json(result);
});

exports.verify = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment(req.user.id, {
    localOrderId: req.body.localOrderId,
    razorpayPaymentId: req.body.razorpay_payment_id,
    razorpayOrderId: req.body.razorpay_order_id,
    razorpaySignature: req.body.razorpay_signature
  });
  res.json(result);
});

exports.webhook = asyncHandler(async (req, res) => {
  const result = await paymentService.processWebhook(req.body, req.headers);
  res.json({ received: true, duplicate: result.duplicate });
});
