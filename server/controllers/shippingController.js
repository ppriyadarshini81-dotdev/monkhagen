const asyncHandler = require('../middleware/asyncHandler');
const shipping = require('../services/shippingService');

exports.serviceability = asyncHandler(async (req, res) => {
  res.json(await shipping.serviceability(req.body || {}));
});

exports.createShipment = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const parcel = {};
  for (const field of ['pickup_location', 'weight', 'length', 'breadth', 'height']) {
    if (body[field] !== undefined) parcel[field] = body[field];
  }
  res.json(await shipping.createShipment(body.orderId, parcel));
});

exports.assignAwb = asyncHandler(async (req, res) => {
  res.json(await shipping.assignAwb(req.params.orderId, req.body?.courier_id));
});

exports.generatePickup = asyncHandler(async (req, res) => {
  res.json(await shipping.generatePickup(req.params.orderId));
});

exports.generateLabel = asyncHandler(async (req, res) => {
  res.json(await shipping.generateLabel(req.params.orderId));
});

exports.tracking = asyncHandler(async (req, res) => {
  res.json(await shipping.tracking(req.params.orderId, req.user));
});

exports.reconcile = asyncHandler(async (req, res) => {
  res.json(await shipping.reconcile(req.params.orderId, req.body?.shiprocket_order_id));
});
