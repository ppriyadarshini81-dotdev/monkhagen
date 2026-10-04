const router = require('express').Router();
const controller = require('../controllers/adminStockController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validation = require('../middleware/validation');

validation.params(router);
router.use(authenticate, requireAdmin);
router.get('/', controller.list);
router.get('/:inventoryId/history', controller.history);
router.post('/:inventoryId/adjust', validation.body('stockAdjustment'), controller.adjust);
module.exports = router;
