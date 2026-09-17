const router = require('express').Router();
const { createLimiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/shippingController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate);
router.use(createLimiter('shipping', { windowMs: 60000, limit: 30, authenticated: true }));

router.post('/serviceability', ctrl.serviceability);
router.get('/:orderId/tracking', ctrl.tracking);
router.post('/create-shipment', requireAdmin, ctrl.createShipment);
router.post('/:orderId/assign-awb', requireAdmin, ctrl.assignAwb);
router.post('/:orderId/generate-pickup', requireAdmin, ctrl.generatePickup);
router.post('/:orderId/generate-label', requireAdmin, ctrl.generateLabel);
router.post('/:orderId/reconcile', requireAdmin, ctrl.reconcile);

router.use((error, _req, res, _next) => {
  const known = /^(SHIPROCKET_|SHIPPING_|SHIPMENT_|ORDER_|PAYMENT_|AWB_|COURIER_)/.test(error.code || '');
  const code = known ? error.code : 'SHIPPING_INTERNAL_ERROR';
  console.error('Shipping request failed:', { code });
  res.status(known ? error.status || 500 : 500).json({
    code, message: known ? error.message : 'The shipping request could not be completed.'
  });
});

module.exports = router;
