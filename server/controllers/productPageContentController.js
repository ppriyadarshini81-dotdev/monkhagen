const ProductPageContent = require('../models/ProductPageContent');
const asyncHandler = require('../middleware/asyncHandler');

exports.get = asyncHandler(async (_req, res) => {
  const content = await ProductPageContent.get();
  if (!content) return res.status(503).json({ message: 'Product page content has not been initialized.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(content);
});

exports.save = asyncHandler(async (req, res) => {
  const limits = { sizeChartImageUrl: 2048, careInstructions: 10000, deliveryEstimate: 200, deliveryNote: 2000 };
  const content = {};
  for (const [field, limit] of Object.entries(limits)) {
    const value = req.body?.[field];
    if (typeof value !== 'string' || value.length > limit) {
      return res.status(400).json({ message: `Invalid ${field}: enter text up to ${limit} characters.` });
    }
    content[field] = value.trim();
  }
  if (!content.deliveryEstimate) {
    return res.status(400).json({ message: 'Delivery estimate is required.' });
  }
  if (content.sizeChartImageUrl) {
    try {
      const url = new URL(content.sizeChartImageUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid URL');
      content.sizeChartImageUrl = url.href;
    } catch {
      return res.status(400).json({ message: 'Size chart must be a valid HTTPS image URL without credentials.' });
    }
  }
  const saved = await ProductPageContent.save(content);
  res.setHeader('Cache-Control', 'no-store');
  res.json(saved);
});
