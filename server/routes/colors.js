const router = require('express').Router();
const ctrl = require('../controllers/variantOptionController')('colors', 'Color');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validation = require('../middleware/validation');
validation.params(router);
router.use(validation.requestShape, validation.body('named'));

router.get('/', ctrl.list);
router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.post('/', authenticate, requireAdmin, ctrl.create);
router.put('/:id', authenticate, requireAdmin, ctrl.update);
router.delete('/:id', authenticate, requireAdmin, ctrl.remove);

module.exports = router;
