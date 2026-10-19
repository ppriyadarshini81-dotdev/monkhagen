const asyncHandler = require('../middleware/asyncHandler');
const validation = require('../middleware/validation');
const returns = require('../services/returnService');
const { pool } = require('../config/db');
const codRefunds = require('../services/codRefundService');

exports.list = asyncHandler(async (req, res) => res.json(
  await returns.listAdminReturns(pool, { ...req.query, ...validation.pagination(req.query), tab: req.query.tab || 'all' })
));
exports.outboundOrders = asyncHandler(async (req, res) => res.json(
  await require('../models/Order').findAll({ ...req.query, ...validation.pagination(req.query), afterSales: true })
));
exports.get = asyncHandler(async (req, res) => {
  const row = await returns.findReturn(pool, req.params.returnId, null, true);
  if (!row) return res.status(404).json({ message: 'Return request not found.' });
  res.json(returns.formatReturn(row));
});
exports.approve = asyncHandler(async (req, res) => res.json(await returns.approveReturn(req.params.returnId)));
exports.reviewDefectPhotos = asyncHandler(async (req, res) => res.json(await require('../services/defectPhotoService').review(
  req.params.returnId, req.body, req.user.id
)));
exports.inspectItem = asyncHandler(async (req, res) => res.json(await returns.inspectReturnItem(
  req.params.returnId, req.params.itemId, req.body, req.user.id
)));
exports.createReplacementShipment = asyncHandler(async (req, res) => res.json(await returns.createReplacementShipment(
  req.params.returnId, req.user.id
)));
exports.submitInspection = asyncHandler(async (req, res) => res.json(await returns.submitReplacementInspection(
  req.params.returnId, req.body, req.user.id
)));
exports.reject = asyncHandler(async (req, res) => res.json(await returns.rejectReturn(req.params.returnId, {
  confirmedNoRemote: req.body?.confirmedNoRemote === true
})));
exports.refund = asyncHandler(async (req, res) => res.json(await returns.initiateRefund(req.params.returnId)));
exports.retry = asyncHandler(async (req, res) => res.json(returns.formatReturn(await returns.provisionReturn(req.params.returnId))));
exports.grantEligibilityOverride = asyncHandler(async (req, res) =>
  res.status(201).json(await returns.grantEligibilityOverride(req.user.id, req.body))
);
exports.eligibilityOverrideHistory = asyncHandler(async (req, res) =>
  res.json(await returns.listEligibilityOverrideHistory(req.query.orderId))
);
exports.revealRefundDestination = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await codRefunds.reveal(req.user.id, req.params.returnId));
});
exports.startCodRefund = asyncHandler(async (req, res) => {
  await codRefunds.start(req.user.id, req.params.returnId);
  const row = await returns.findReturn(pool, req.params.returnId, null, true);
  res.json(returns.formatReturn(row));
});
exports.failCodRefund = asyncHandler(async (req, res) => {
  await codRefunds.fail(req.user.id, req.params.returnId, req.body);
  const row = await returns.findReturn(pool, req.params.returnId, null, true);
  res.json(returns.formatReturn(row));
});
exports.completeCodRefund = asyncHandler(async (req, res) => {
  await codRefunds.complete(req.user.id, req.params.returnId, req.body);
  const row = await returns.findReturn(pool, req.params.returnId, null, true);
  res.json(returns.formatReturn(row));
});
