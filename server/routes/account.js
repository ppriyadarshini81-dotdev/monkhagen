const router = require('express').Router();
const ctrl = require('../controllers/accountController');
const { authenticate } = require('../middleware/auth');
const { returnLimiter, createLimiter } = require('../middleware/rateLimit');
const validation = require('../middleware/validation');
validation.params(router);

// All account routes require authentication
router.use(authenticate);
const accountMutationLimiter = createLimiter('account-mutations', { limit: 60, windowMs: 15 * 60000, authenticated: true });
const invoiceLimiter = createLimiter('invoice-downloads', { limit: 10, windowMs: 60000, authenticated: true });
router.use((req, res, next) => ['POST','PUT','PATCH','DELETE'].includes(req.method) ? accountMutationLimiter(req, res, next) : next());

// Profile
router.get('/profile',          ctrl.getProfile);
router.put('/profile', validation.body('profile'), ctrl.updateProfile);

// Addresses
router.get('/addresses',             ctrl.getAddresses);
router.get('/addresses/default',     ctrl.getDefaultAddress);
router.get('/addresses/locations',   ctrl.getAddressLocations);
router.post('/addresses',            ctrl.addAddress);
router.put('/addresses/:id',         ctrl.updateAddress);
router.delete('/addresses/:id',      ctrl.deleteAddress);
router.patch('/addresses/:id/default', ctrl.setDefaultAddress);

// Orders
router.get('/orders',                    ctrl.getOrders);
router.get('/orders/:orderId',           ctrl.getOrder);
router.get('/orders/:orderId/tracking',  ctrl.getTracking);
router.get('/orders/:orderId/invoice', invoiceLimiter, ctrl.getInvoice);

// Returns
router.get('/returns',   ctrl.getReturns);
router.post('/returns', returnLimiter, ctrl.createReturn);

// Credits
router.get('/credits',              ctrl.getCredits);
router.get('/credits/transactions', ctrl.getCreditTransactions);

module.exports = router;
