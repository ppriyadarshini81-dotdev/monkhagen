const router = require('express').Router();
const ctrl = require('../controllers/accountController');
const { authenticate } = require('../middleware/auth');
const { returnLimiter } = require('../middleware/rateLimit');

// All account routes require authentication
router.use(authenticate);

// Profile
router.get('/profile',          ctrl.getProfile);
router.put('/profile',          ctrl.updateProfile);

// Addresses
router.get('/addresses',             ctrl.getAddresses);
router.get('/addresses/default',     ctrl.getDefaultAddress);
router.post('/addresses',            ctrl.addAddress);
router.put('/addresses/:id',         ctrl.updateAddress);
router.delete('/addresses/:id',      ctrl.deleteAddress);
router.patch('/addresses/:id/default', ctrl.setDefaultAddress);

// Orders
router.get('/orders',                    ctrl.getOrders);
router.get('/orders/:orderId',           ctrl.getOrder);
router.get('/orders/:orderId/tracking',  ctrl.getTracking);

// Returns
router.get('/returns',   ctrl.getReturns);
router.post('/returns', returnLimiter, ctrl.createReturn);

// Credits
router.get('/credits',              ctrl.getCredits);
router.get('/credits/transactions', ctrl.getCreditTransactions);

module.exports = router;
