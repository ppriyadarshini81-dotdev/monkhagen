const Badge = require('../models/Badge');
const asyncHandler = require('../middleware/asyncHandler');

function requiredName(value) {
  const name = String(value || '').trim();
  return name || null;
}

exports.list = asyncHandler(async (_req, res) => {
  res.json(await Badge.find({ activeOnly: true }));
});

exports.adminList = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await Badge.find({ activeOnly: false }));
});

exports.create = asyncHandler(async (req, res) => {
  const name = requiredName(req.body.name);
  if (!name) return res.status(400).json({ message: 'Badge name is required.' });
  res.status(201).json(await Badge.create({ name }));
});

exports.update = asyncHandler(async (req, res) => {
  const data = {};
  if (req.body.name !== undefined) {
    data.name = requiredName(req.body.name);
    if (!data.name) return res.status(400).json({ message: 'Badge name is required.' });
  }
  if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
  const badge = await Badge.update(req.params.id, data);
  if (!badge) return res.status(404).json({ message: 'Badge not found.' });
  res.json(badge);
});

exports.remove = asyncHandler(async (req, res) => {
  const badge = await Badge.remove(req.params.id);
  if (!badge) return res.status(404).json({ message: 'Badge not found.' });
  res.json({ message: 'Badge deleted.', id: badge.id });
});
