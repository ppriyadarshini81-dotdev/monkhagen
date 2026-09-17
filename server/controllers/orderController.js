const Order = require('../models/Order');
const asyncHandler = require('../middleware/asyncHandler');
const shipping = require('../services/shippingService');

// POST /api/orders — checkout
exports.create = asyncHandler(async (req, res) => {
  const { paymentMethod = 'cod' } = req.body;
  if (paymentMethod !== 'cod') return res.status(400).json({ message: 'Use Razorpay checkout for prepaid orders.' });
  const order = await Order.createCod(req.user.id, req.body);
  void shipping.processPendingOrder(order.id);
  res.status(201).json(order);
});
// GET /api/orders/mine
exports.mine = asyncHandler(async (req, res) => {
  const orders = await Order.findByUser(req.user.id);
  res.json(orders);
});

// GET /api/orders — admin
exports.all = asyncHandler(async (_req, res) => {
  const orders = await Order.findAll();
  res.json(orders);
});

// PUT /api/orders/:id/status — admin
exports.updateStatus = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndUpdateStatus(req.params.id, req.body.status);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  res.json(order);
});
