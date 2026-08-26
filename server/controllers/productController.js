const Product = require('../models/Product');
const Category = require('../models/Category');
const { deleteFile } = require('../config/r2');
const asyncHandler = require('../middleware/asyncHandler');

// GET /api/products?category=&search=&featured=
exports.list = asyncHandler(async (req, res) => {
  const { category, search, featured } = req.query;
  const products = await Product.findAll({ category, search, featured: featured === 'true' });
  res.json(products);
});

// GET /api/products/categories
exports.categories = asyncHandler(async (_req, res) => {
  const cats = await Category.find();
  res.json(cats.map((c) => c.name));
});

// GET /api/products/:idOrSlug
exports.getOne = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const product = Product.isValidId(idOrSlug)
    ? await Product.findById(idOrSlug)
    : await Product.findBySlug(idOrSlug);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json(product);
});

// POST /api/products — admin
exports.create = asyncHandler(async (req, res) => {
  const product = await Product.create(sanitize(req.body));
  res.status(201).json(product);
});

// PUT /api/products/:id — admin
exports.update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id, { full: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  // Delete R2 objects for images removed from the product
  const payload = sanitize(req.body);
  if (Array.isArray(payload.images)) {
    const newUrls = new Set(payload.images.map((i) => i?.url ?? i));
    const removed = product.images.filter((url) => !newUrls.has(url));
    await Promise.allSettled(removed.map(deleteFile));
  }

  const updated = await Product.update(req.params.id, payload);
  res.json(updated);
});

// DELETE /api/products/:id — admin
exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id, { full: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  // Delete all R2 images before removing the product record
  await Promise.allSettled(product.images.map(deleteFile));
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: 'Product deleted.', id: product.id });
});

function sanitize(body) {
  const allowed = ['name', 'description', 'basePrice', 'categoryId', 'featured', 'badge', 'isActive', 'images', 'variants'];
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
