const router = require('express').Router();
const ctrl = require('../controllers/shiprocketWebhookController');
router.post('/', ctrl.tracking);
module.exports = router;
