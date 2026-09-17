const Product = require('../models/Product');
const Category = require('../models/Category');
const { deleteFile } = require('../config/r2');
const asyncHandler = require('../middleware/asyncHandler');

// GET /api/products?category=&search=&featured=
exports.list = asyncHandler(async (req, res) => {
  const { category, search, featured } = req.query;
  const products = await Product.findAll({ category, search, featured: featured === 'true', ...require('../middleware/validation').pagination(req.query) });
  res.json(products);
});

// Protected catalog reads retain unpublished records for administration.
exports.adminList = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await Product.findAll({ activeOnly: false, ...require('../middleware/validation').pagination(req.query) }));
});

exports.adminGetOne = asyncHandler(async (req, res) => {
  const product = Product.isValidId(req.params.idOrSlug)
    ? await Product.findById(req.params.idOrSlug)
    : await Product.findBySlug(req.params.idOrSlug);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.set('Cache-Control', 'no-store');
  res.json(product);
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
    ? await Product.findById(idOrSlug, { activeOnly: true })
    : await Product.findBySlug(idOrSlug, { activeOnly: true });
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

  const payload = sanitize(req.body);
  const removed = [];
  if (Array.isArray(payload.images)) {
    const newUrls = new Set(payload.images.map((i) => i?.url ?? i));
    removed.push(...product.images.filter((url) => !newUrls.has(url)));
  }

  const updated = await Product.update(req.params.id, payload);
  // Remove obsolete R2 objects only after the database transaction succeeds.
  await Promise.allSettled(removed.map(deleteFile));
  res.json(updated);
});

// DELETE /api/products/:id — admin
exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id, { full: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  await Product.findByIdAndDelete(req.params.id);
  // A blocked/failed database delete must never remove live product assets.
  await Promise.allSettled(product.images.map(deleteFile));
  res.json({ message: 'Product deleted.', id: product.id });
});

function sanitize(body) {
  const allowed = [
    'name', 'description', 'basePrice', 'categoryId', 'featured', 'badgeId',
    'isActive', 'images', 'variants', 'sizeIds', 'colorIds'
  ];
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
