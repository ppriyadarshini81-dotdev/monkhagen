const router = require('express').Router();
const ctrl = require('../controllers/badgeController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.list);
router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.post('/', authenticate, requireAdmin, ctrl.create);
router.put('/:id', authenticate, requireAdmin, ctrl.update);
router.delete('/:id', authenticate, requireAdmin, ctrl.remove);

module.exports = router;
