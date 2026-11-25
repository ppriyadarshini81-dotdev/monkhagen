const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const settings = require('../models/BannerSettings');
router.get('/', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const content = await settings.get();
  if (!content) return res.status(503).json({ message: 'Banner settings are not initialized.' });
  res.json(content);
}));
router.put('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { messages, revision } = req.body || {};
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483646 ||
    !Array.isArray(messages) || messages.length < 1 || messages.length > 12 ||
    messages.some(value => typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) {
    return res.status(400).json({ message: 'Enter 1–12 messages, each containing 1–120 characters on a single line.' });
  }
  const content = await settings.save({ messages: messages.map(value => value.trim()), revision });
  res.set('Cache-Control', 'no-store');
  res.json(content);
}));
module.exports = router;
