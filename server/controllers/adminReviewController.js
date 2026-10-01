const asyncHandler = require('../middleware/asyncHandler');
const validation = require('../middleware/validation');
const reviews = require('../services/reviewService');

exports.list = asyncHandler(async (req, res) => {
  const { limit, offset } = validation.pagination(req.query);
  if (req.query.productId && !validation.UUID.test(req.query.productId)) {
    throw reviews.reviewError(400, 'PRODUCT_ID_INVALID', 'Invalid product filter.');
  }
  res.set('Cache-Control', 'no-store');
  res.json(await reviews.adminList({
    limit, offset,
    productId: req.query.productId || null,
    rating: req.query.rating == null ? null : Number(req.query.rating),
    status: req.query.status || null,
    search: req.query.search || ''
  }));
});

exports.moderate = asyncHandler(async (req, res) => {
  res.json(await reviews.moderate(req.params.reviewId, req.body.status));
});
