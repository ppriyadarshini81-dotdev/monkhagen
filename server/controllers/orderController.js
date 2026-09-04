const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const asyncHandler = require('../middleware/asyncHandler');
const { pool } = require('../config/db');

// POST /api/orders — checkout
exports.create = asyncHandler(async (req, res) => {
  const { addressId, paymentMethod = 'cod' } = req.body;
  const savedCart = await Cart.getWithItems(req.user.id);
  if (savedCart.items.length === 0) {
    return res.status(400).json({ message: 'Cart is empty.' });
  }
  const { rows: addressRows } = await pool.query(
    `SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2`,
    [addressId, req.user.id]
  );
  const savedAddress = addressRows[0];
  if (!savedAddress) return res.status(400).json({ message: 'Select a saved shipping address.' });
  const address = {
    fullName: savedAddress.full_name,
    phone: savedAddress.phone,
    addressLine1: savedAddress.address_line1,
    addressLine2: savedAddress.address_line2,
    landmark: savedAddress.landmark,
    city: savedAddress.city,
    state: savedAddress.state,
    postalCode: savedAddress.postal_code,
    country: savedAddress.country
  };

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

  // Keep legacy COD checkout server-priced; Razorpay uses /api/payments/create-order.
  const shippingAmount = subtotal >= 2999 ? 0 : 99;
  const order = await Order.create({
    userId: req.user.id,
    items: lineItems,
    address,
    subtotal,
    shippingAmount,
    totalAmount: subtotal + shippingAmount,
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
