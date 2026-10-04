const Order = require('../models/Order');
const asyncHandler = require('../middleware/asyncHandler');
const shipping = require('../services/shippingService');
const analytics = require('../services/analyticsService');
const emails = require('../services/transactionalEmailService');
const sms = require('../services/transactionalSmsService');

// POST /api/orders — checkout
exports.create = asyncHandler(async (req, res) => {
  const { paymentMethod = 'cod' } = req.body;
  if (paymentMethod !== 'cod') return res.status(400).json({ message: 'Use Razorpay checkout for prepaid orders.' });
  const order = await Order.createCod(req.user.id, req.body);
  await analytics.linkOrderSession(req, order.id);
  await analytics.recordServerEvent(req, 'ORDER_CREATED', {
    orderId: order.id,
    dedupeKey: `order-created:${order.id}`
  });
  await emails.orderConfirmed(order.id).catch(() => {});
  await sms.orderConfirmed(order.id).catch(() => {});
  if (!process.env.VERCEL) void shipping.processPendingOrder(order.id);
  res.status(201).json(order);
});
// GET /api/orders/mine
exports.mine = asyncHandler(async (req, res) => {
  const orders = await Order.findByUser(req.user.id, require('../middleware/validation').pagination(req.query));
  res.json(orders);
});

// GET /api/orders — admin
exports.all = asyncHandler(async (req, res) => {
  const orders = await Order.findAll(require('../middleware/validation').pagination(req.query));
  res.json(orders);
});

// PUT /api/orders/:id/status — admin
exports.updateStatus = asyncHandler(async (req, res) => {
  if (!Object.hasOwn(require('../services/orderStatusPolicy').NEXT, req.body.status || '')) return res.status(400).json({ message: 'Invalid order status.' });
  const order = await Order.findByIdAndUpdateStatus(req.params.id, req.body.status);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (req.body.status === 'shipped') await emails.orderShipped(order.id).catch(() => {});
  if (req.body.status === 'delivered') await emails.orderDelivered(order.id).catch(() => {});
  res.json(order);
});
