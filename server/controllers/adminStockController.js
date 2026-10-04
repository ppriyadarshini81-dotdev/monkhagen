const asyncHandler = require('../middleware/asyncHandler');
const stock = require('../services/stockService');

exports.list = asyncHandler(async (req, res) => res.json(await stock.list(req.query)));
exports.adjust = asyncHandler(async (req, res) => res.json(await stock.adjust(req.params.inventoryId, req.body, req.user.id)));
exports.history = asyncHandler(async (req, res) => res.json(await stock.history(req.params.inventoryId)));
