const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { optionalAuthenticate } = require('../middleware/auth');
const { analyticsLimiter } = require('../middleware/rateLimit');

router.use(optionalAuthenticate, analyticsLimiter);
router.post('/session', ctrl.startSession);
router.post('/session/touch', ctrl.touchSession);
router.post('/events', ctrl.events);

module.exports = router;
