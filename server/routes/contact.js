const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const ctrl = require('../controllers/contactController');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many queries sent. Please try again in 15 minutes.' }
});

router.post('/', contactLimiter, ctrl.sendQuery);

module.exports = router;
