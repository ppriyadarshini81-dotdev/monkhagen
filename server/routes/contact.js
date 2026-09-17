const router = require('express').Router();
const { createLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/contactController');

const contactLimiter = createLimiter('contact', { windowMs: 15 * 60000, limit: 5 });

router.post('/', contactLimiter, ctrl.sendQuery);

module.exports = router;
