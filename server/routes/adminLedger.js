const router = require('express').Router();
const controller = require('../controllers/adminLedgerController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { params } = require('../middleware/validation');

router.use(authenticate, requireAdmin);
params(router);
router.get('/export', controller.exportExcel);
router.get('/', controller.list);
router.get('/:id', controller.detail);

module.exports = router;
