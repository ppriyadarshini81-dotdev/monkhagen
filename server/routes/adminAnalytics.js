const router = require('express').Router();
const controller = require('../controllers/adminAnalyticsController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);
router.get('/overview', controller.overview);
router.get('/revenue', controller.revenue);
router.get('/funnel', controller.funnel);
router.get('/products', controller.products);
router.get('/carts', controller.carts);
router.get('/payments', controller.payments);
router.get('/visitors', controller.visitors);

module.exports = router;
