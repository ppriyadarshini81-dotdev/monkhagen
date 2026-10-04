const asyncHandler = require('../middleware/asyncHandler');
const validation = require('../middleware/validation');
const reviews = require('../services/reviewService');
const { uploadPath, deleteFile } = require('../config/r2');

function booleanField(value) { return value === true || value === 'true'; }

async function uploadFiles(files = []) {
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await uploadPath(file, 'reviews');
      uploaded.push({ ...result, mimeType: file.mimetype });
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(uploaded.map(file => deleteFile(file.key)));
    throw error;
  }
}

exports.summary = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await reviews.summary(req.params.productId));
});

exports.list = asyncHandler(async (req, res) => {
  const { limit, offset } = validation.pagination(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await reviews.listReviews(req.params.productId, {
    userId: req.user?.id || null, limit, offset, sort: req.query.sort || 'recent'
  }));
});

exports.eligibility = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await reviews.eligibility(req.params.productId, req.user.id));
});

exports.create = asyncHandler(async (req, res) => {
  const state = await reviews.eligibility(req.params.productId, req.user.id);
  if (!state.eligible) throw reviews.reviewError(403, 'REVIEW_NOT_ELIGIBLE', 'Only a verified buyer with a delivered order can review this product.');
  if (state.hasReview) throw reviews.reviewError(409, 'REVIEW_ALREADY_EXISTS', 'You have already reviewed this product.');
  const uploaded = await uploadFiles(req.files);
  try {
    const created = await reviews.createReview(req.params.productId, req.user.id, {
      rating: req.body.rating, text: req.body.text, orderItemId: state.orderItemId
    }, uploaded);
    res.status(201).json(created);
  } catch (error) {
    await Promise.allSettled(uploaded.map(file => deleteFile(file.key)));
    throw error;
  }
});

exports.update = asyncHandler(async (req, res) => {
  await reviews.assertOwner(req.params.productId, req.params.reviewId, req.user.id);
  const uploaded = await uploadFiles(req.files);
  const replaceImages = booleanField(req.body.replaceImages) || uploaded.length > 0;
  try {
    const updated = await reviews.updateReview(req.params.productId, req.params.reviewId, req.user.id, {
      rating: req.body.rating, text: req.body.text
    }, uploaded, replaceImages);
    await Promise.allSettled(updated.oldKeys.map(deleteFile));
    res.json({ id: updated.id });
  } catch (error) {
    await Promise.allSettled(uploaded.map(file => deleteFile(file.key)));
    throw error;
  }
});

exports.helpful = asyncHandler(async (req, res) => {
  res.json(await reviews.setHelpful(req.params.productId, req.params.reviewId, req.user.id, req.method === 'POST'));
});
