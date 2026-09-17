const router = require('express').Router();
const ctrl = require('../controllers/paymentController');

router.post('/', ctrl.webhook);

module.exports = router;
