const Cart = require('../models/Cart');
const asyncHandler = require('../middleware/asyncHandler');

// GET /api/cart
exports.get = asyncHandler(async (req, res) => {
  const cart = await Cart.getWithItems(req.user.id);
  res.json(cart);
});

// POST /api/cart/items
exports.addItem = asyncHandler(async (req, res) => {
  const { productId, variantId, quantity = 1 } = req.body;
  if (!variantId) return res.status(400).json({ message: 'variantId is required.' });
  const cart = await Cart.addItem(req.user.id, { productId, variantId, quantity: Math.max(1, quantity) });
  res.json(cart);
});

// PUT /api/cart/items/:itemId
exports.updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) return res.status(400).json({ message: 'quantity must be >= 1.' });
  const cart = await Cart.updateItem(req.user.id, req.params.itemId, { quantity });
  res.json(cart);
});

// DELETE /api/cart/items/:itemId
exports.removeItem = asyncHandler(async (req, res) => {
  const cart = await Cart.removeItem(req.user.id, req.params.itemId);
  res.json(cart);
});

// DELETE /api/cart
exports.clear = asyncHandler(async (req, res) => {
  await Cart.clear(req.user.id);
  res.json({ message: 'Cart cleared.' });
});
