const router = require('express').Router();
const ctrl = require('../controllers/mediaController');

router.get('/', ctrl.proxyImage);

module.exports = router;
