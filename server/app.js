const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { configureSecurity } = require('./config/httpSecurity');
const { allowedCorsOrigins } = require('./config/security');
const { requestShape } = require('./middleware/validation');
const { notFound, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  configureSecurity(app);
  const origins = allowedCorsOrigins();
  app.use(cors({ origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true);
    callback(Object.assign(new Error('Origin is not allowed by CORS.'), { status: 403 }));
  } }));
  app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), require('./routes/webhooks'));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/webhooks/tracking-updates', require('./routes/shiprocketWebhook'));
  app.use('/api', requestShape);
  app.use('/api/admin/analytics', require('./routes/adminAnalytics'));
  app.use('/api/admin/ledger', require('./routes/adminLedger'));
  app.use('/api/admin/stock', require('./routes/adminStock'));
  app.use('/api/admin/returns', require('./routes/adminReturns'));
  app.use('/api/admin/reviews', require('./routes/adminReviews'));
  app.use('/api/products', require('./routes/productReviews'));
  const routes = { products: 'products', 'product-page-content': 'productPageContent', categories: 'categories',
    badges: 'badges', sizes: 'sizes', colors: 'colors', auth: 'auth', orders: 'orders', cart: 'cart',
    upload: 'upload', account: 'account', contact: 'contact', media: 'media', payments: 'payments',
    shipping: 'shipping', maintenance: 'maintenance', analytics: 'analytics', newsletter: 'newsletter' };
  for (const [url, file] of Object.entries(routes)) app.use(`/api/${url}`, require(`./routes/${file}`));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', brand: 'Monk Hagen' }));
  if (process.env.NODE_ENV === 'production') {
    // Production hosts only the API; Angular is served independently by Cloudflare.
    app.get('/', (_req, res) => res.json({ status: 'ok', service: 'Monk Hagen API' }));
  } else {
    const directory = path.join(__dirname, '..', 'dist', 'clothing-ui', 'browser');
    app.use(express.static(directory));
    app.get(/^(?!\/api).*/, (_req, res, next) => res.sendFile(path.join(directory, 'index.html'), error => { if (error) next(error); }));
  }
  app.use(notFound, errorHandler);
  return app;
}
module.exports = { createApp };
