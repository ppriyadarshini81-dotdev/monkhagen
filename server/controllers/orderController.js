const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/orders — checkout
exports.create = asyncHandler(async (req, res) => {
  const { address, shippingAmount = 0, paymentMethod = 'cod' } = req.body;
  const savedCart = await Cart.getWithItems(req.user.id);
  if (savedCart.items.length === 0) {
    return res.status(400).json({ message: 'Cart is empty.' });
  }
  if (!address?.fullName || !address?.addressLine1 || !address?.city || !address?.postalCode) {
    return res.status(400).json({ message: 'Shipping address is required.' });
  }

  // Prices are always calculated from DB — never trust client-submitted totals
  let subtotal = 0;
  const lineItems = [];
  for (const item of savedCart.items) {
    const variant = await Product.findVariantById(item.variantId);
    if (!variant) {
      return res.status(400).json({ message: `Variant ${item.variantId} not found.` });
    }
    if (variant.stock < item.quantity) {
      return res.status(400).json({
        message: `Insufficient stock for ${variant.productName} (${variant.size}/${variant.color}).`
      });
    }
    const qty = Math.max(1, Number(item.quantity) || 1);
    subtotal += variant.price * qty;
    lineItems.push({
      productId: variant.productId,
      variantId: variant.id,
      productName: variant.productName,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      quantity: qty,
      unitPrice: variant.price,
      totalPrice: variant.price * qty
    });
  }

  const order = await Order.create({
    userId: req.user.id,
    items: lineItems,
    address,
    subtotal,
    shippingAmount: Number(shippingAmount),
    totalAmount: subtotal + Number(shippingAmount),
    paymentMethod
  });

  await Cart.markConverted(req.user.id).catch(() => {});
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
