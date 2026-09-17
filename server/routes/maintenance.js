const { timingSafeEqual } = require('node:crypto');
const router = require('express').Router();
const asyncHandler = require('../middleware/asyncHandler');
const { runMaintenance } = require('../services/securityMaintenance');
const { processShippingQueue } = require('../services/shippingWorker');
const { sendPendingConfirmations } = require('../services/emailWorker');

router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ message: 'Scheduled maintenance is not configured.' });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.authorization || '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return res.status(401).json({ message: 'Authentication required.' });
  const result = await require('../models/Shipment').withLock('security-maintenance', async () => {
    const summary = await runMaintenance();
    const shipping = await processShippingQueue({ limit: 1 });
    const emails = await sendPendingConfirmations({ limit: 1 });
    return { ...summary, shippingOrdersChecked: shipping, confirmationEmailsSent: emails };
  });
  // Release the durable lease before ending a serverless response.
  res.json(result);
}));
module.exports = router;
