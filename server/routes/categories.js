const router = require('express').Router();
const ctrl = require('../controllers/categoryController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validation = require('../middleware/validation');
validation.params(router);
router.use(validation.requestShape, validation.body('category'));

router.get('/', ctrl.list);
router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.get('/:idOrSlug', ctrl.getOne);
router.post('/', authenticate, requireAdmin, ctrl.create);
router.put('/:id', authenticate, requireAdmin, ctrl.update);
router.delete('/:id', authenticate, requireAdmin, ctrl.remove);

module.exports = router;
