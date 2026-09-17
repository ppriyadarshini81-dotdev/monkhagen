const Cart = require('../models/Cart');
const asyncHandler = require('../middleware/asyncHandler');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : null;
}

exports.get = asyncHandler(async (req, res) => {
  const cart = await Cart.getWithItems(req.user.id);
  res.json(cart);
});

exports.addItem = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.body;
  const quantity = positiveInteger(req.body.quantity ?? 1);

  if (!UUID_RE.test(productId || '') || !UUID_RE.test(variantId || '')) {
    return res.status(400).json({ message: 'Valid productId and variantId are required.' });
  }
  if (!quantity) {
    return res.status(400).json({ message: 'quantity must be a positive integer.' });
  }

  const cart = await Cart.addItem(req.user.id, { productId, variantId, quantity });
  res.json(cart);
});

exports.updateItem = asyncHandler(async (req, res) => {
  const quantity = positiveInteger(req.body.quantity);
  if (!UUID_RE.test(req.params.itemId || '')) {
    return res.status(400).json({ message: 'Valid itemId is required.' });
  }
  if (!quantity) {
    return res.status(400).json({ message: 'quantity must be a positive integer.' });
  }

  const cart = await Cart.updateItem(req.user.id, req.params.itemId, { quantity });
  res.json(cart);
});

exports.removeItem = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.itemId || '')) {
    return res.status(400).json({ message: 'Valid itemId is required.' });
  }
  const cart = await Cart.removeItem(req.user.id, req.params.itemId);
  res.json(cart);
});

exports.clear = asyncHandler(async (req, res) => {
  await Cart.clear(req.user.id);
  res.json({ message: 'Cart cleared.' });
});
