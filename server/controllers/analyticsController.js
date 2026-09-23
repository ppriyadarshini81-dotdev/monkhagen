const asyncHandler = require('../middleware/asyncHandler');
const analytics = require('../services/analyticsService');

exports.startSession = asyncHandler(async (req, res) => {
  await analytics.ensureSession({
    sessionId: req.body.sessionId,
    visitorId: req.body.visitorId,
    entryPath: req.body.entryPath,
    userId: req.user?.id || null
  });
  res.status(201).json({ accepted: true });
});

exports.touchSession = asyncHandler(async (req, res) => {
  await analytics.touchSession({
    sessionId: req.body.sessionId,
    visitorId: req.body.visitorId,
    ended: req.body.ended === true,
    userId: req.user?.id || null
  });
  res.status(202).json({ accepted: true });
});

exports.events = asyncHandler(async (req, res) => {
  await analytics.ingestEvents({
    sessionId: req.body.sessionId,
    visitorId: req.body.visitorId,
    events: req.body.events,
    userId: req.user?.id || null
  });
  res.status(202).json({ accepted: true });
});
