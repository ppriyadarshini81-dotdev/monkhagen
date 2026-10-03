const asyncHandler = require('../middleware/asyncHandler');
const validation = require('../middleware/validation');
const returns = require('../services/returnService');
const { pool } = require('../config/db');
const codRefunds = require('../services/codRefundService');

exports.list = asyncHandler(async (req, res) => res.json(
  await returns.listAdminReturns(pool, validation.pagination(req.query))
));
exports.get = asyncHandler(async (req, res) => {
  const row = await returns.findReturn(pool, req.params.returnId, null, true);
  if (!row) return res.status(404).json({ message: 'Return request not found.' });
  res.json(returns.formatReturn(row));
});
exports.approve = asyncHandler(async (req, res) => res.json(await returns.approveReturn(req.params.returnId)));
exports.reject = asyncHandler(async (req, res) => res.json(await returns.rejectReturn(req.params.returnId, {
  confirmedNoRemote: req.body?.confirmedNoRemote === true
})));
exports.refund = asyncHandler(async (req, res) => res.json(await returns.initiateRefund(req.params.returnId)));
exports.retry = asyncHandler(async (req, res) => res.json(returns.formatReturn(await returns.provisionReturn(req.params.returnId))));
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
