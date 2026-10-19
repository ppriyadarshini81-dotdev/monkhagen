const router = require('express').Router();
const controller = require('../controllers/adminAnalyticsController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);
router.get('/dashboard', controller.dashboard);
router.get('/overview', controller.overview);
router.get('/revenue', controller.revenue);
router.get('/funnel', controller.funnel);
router.get('/products', controller.products);
router.get('/carts', controller.carts);
router.get('/payments', controller.payments);
router.get('/visitors', controller.visitors);
router.get('/logins', controller.logins);
router.get('/returns', controller.returns);
router.get('/errors', controller.errors);
router.get('/trend', controller.trend);
router.get('/drilldown', controller.drilldown);

module.exports = router;
