const router = require('express').Router();
const ctrl = require('../controllers/productPageContentController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.get);
router.put('/', authenticate, requireAdmin, ctrl.save);

module.exports = router;
