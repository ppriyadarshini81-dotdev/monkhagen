require('dotenv').config({ quiet: true });
const { connectDB } = require('./config/db');
const { createApp } = require('./app');
const { startShippingWorker } = require('./services/shippingWorker');
const { startEmailWorker } = require('./services/emailWorker');
const { startSmsWorker } = require('./services/smsWorker');
const { startMaintenanceWorker } = require('./services/securityMaintenance');

const app = createApp();
connectDB().then(() => {
  app.listen(process.env.PORT || 3000, () => {
    console.log('Monk Hagen backend is ready.');
    // Vercel queues are invoked through authenticated scheduled requests.
    if (!process.env.VERCEL) {
      startShippingWorker();
      startEmailWorker();
      startSmsWorker();
      startMaintenanceWorker();
    }
  });
}).catch(() => {
  console.error('Backend startup failed; internal details suppressed.');
  process.exitCode = 1;
});
