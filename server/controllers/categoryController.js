const Category = require('../models/Category');
const Product = require('../models/Product');
const asyncHandler = require('../middleware/asyncHandler');

// GET /api/categories
exports.list = asyncHandler(async (_req, res) => {
  const categories = await Category.find({ activeOnly: true });
  const counts = await Product.categoryProductCounts();
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  res.json(categories.map((c) => ({ ...c, productCount: countMap[c.name] || 0 })));
});

exports.adminList = asyncHandler(async (_req, res) => {
  const categories = await Category.find({ activeOnly: false });
  const counts = await Product.categoryProductCounts();
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  res.set('Cache-Control', 'no-store');
  res.json(categories.map((c) => ({ ...c, productCount: countMap[c.name] || 0 })));
});

// GET /api/categories/:idOrSlug
exports.getOne = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.idOrSlug, activeOnly: true });
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json(category);
});

// POST /api/categories — admin
exports.create = asyncHandler(async (req, res) => {
  const { name, image, description } = req.body;
  const category = await Category.create({ name, image, description });
  res.status(201).json(category);
});

// PUT /api/categories/:id — admin
exports.update = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json(category);
});

// DELETE /api/categories/:id — admin
exports.remove = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ message: 'Category deleted.', id: category.id });
});
