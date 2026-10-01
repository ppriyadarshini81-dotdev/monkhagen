const asyncHandler = require('../middleware/asyncHandler');
const validation = require('../middleware/validation');
const returns = require('../services/returnService');
const { pool } = require('../config/db');

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
