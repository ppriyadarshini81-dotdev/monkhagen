const router = require('express').Router();
const ctrl = require('../controllers/reviewController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimit');
const validation = require('../middleware/validation');
const reviewUpload = require('../middleware/reviewUpload');

validation.params(router);
const writeLimiter = createLimiter('reviews-write', { limit: 15, windowMs: 15 * 60000, authenticated: true });
const helpfulLimiter = createLimiter('reviews-helpful', { limit: 60, windowMs: 15 * 60000, authenticated: true });

router.get('/:productId/reviews/summary', ctrl.summary);
router.get('/:productId/reviews', optionalAuthenticate, ctrl.list);
router.get('/:productId/reviews/eligibility', authenticate, ctrl.eligibility);
router.post('/:productId/reviews', authenticate, writeLimiter, reviewUpload, ctrl.create);
router.patch('/:productId/reviews/:reviewId', authenticate, writeLimiter, reviewUpload, ctrl.update);
router.post('/:productId/reviews/:reviewId/helpful', authenticate, helpfulLimiter, ctrl.helpful);
router.delete('/:productId/reviews/:reviewId/helpful', authenticate, helpfulLimiter, ctrl.helpful);

module.exports = router;
