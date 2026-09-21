const asyncHandler = require('../middleware/asyncHandler');
const paymentService = require('../services/paymentService');
const analytics = require('../services/analyticsService');

exports.createOrder = asyncHandler(async (req, res) => {
  const result = await paymentService.createPaymentOrder(req.user.id, {
    addressId: req.body.addressId,
    checkoutToken: req.body.checkoutToken
  });
  await analytics.linkOrderSession(req, result.localOrderId);
  await analytics.recordServerEvent(req, 'PAYMENT_STARTED', {
    orderId: result.localOrderId,
    dedupeKey: `payment-started:${result.localOrderId}`
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
  await analytics.recordServerEvent(req, 'PAYMENT_SUCCESS', {
    orderId: result.localOrderId,
    dedupeKey: `payment-success:${result.localOrderId}`
  });
  await analytics.recordServerEvent(req, 'ORDER_CREATED', {
    orderId: result.localOrderId,
    dedupeKey: `order-created:${result.localOrderId}`
  });
  res.json(result);
});

exports.webhook = asyncHandler(async (req, res) => {
  const result = await paymentService.processWebhook(req.body, req.headers);
  res.json({ received: true, duplicate: result.duplicate });
});
