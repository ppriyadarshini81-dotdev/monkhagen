const router = require('express').Router();
const { createLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/newsletterController');

router.post('/', createLimiter('newsletter', { windowMs: 15 * 60000, limit: 5 }), ctrl.subscribe);
router.post('/unsubscribe', createLimiter('newsletter-unsubscribe', { windowMs: 15 * 60000, limit: 10 }), ctrl.unsubscribe);

module.exports = router;
