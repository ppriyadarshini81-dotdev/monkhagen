require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/error');

const productRoutes = require('./routes/products');
const productPageContentRoutes = require('./routes/productPageContent');
const categoryRoutes = require('./routes/categories');
const badgeRoutes = require('./routes/badges');
const sizeRoutes = require('./routes/sizes');
const colorRoutes = require('./routes/colors');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');
const uploadRoutes = require('./routes/upload');
const accountRoutes = require('./routes/account');
const contactRoutes = require('./routes/contact');
const mediaRoutes = require('./routes/media');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const shippingRoutes = require('./routes/shipping');
const { startShippingWorker } = require('./services/shippingWorker');
const { startEmailWorker } = require('./services/emailWorker');
const { allowedCorsOrigins } = require('./config/security');

const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigins = allowedCorsOrigins();

// Connect to PostgreSQL.
const databaseReady = connectDB();

app.use(cors({
  origin(origin, callback) {
    // Requests without Origin are same-origin, server-to-server, or command-line clients.
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS.');
    error.status = 403;
    return callback(error);
  }
}));
// Razorpay signatures must be verified against the untouched request bytes.
// This route must remain before express.json().
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes);
app.use(express.json({ limit: '2mb' }));

// API routes
app.use('/api/products', productRoutes);
app.use('/api/product-page-content', productPageContentRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/badges', badgeRoutes);
app.use('/api/sizes', sizeRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/shipping', shippingRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', brand: 'Monk Hagen' });
});

// Serve the built Angular app (after `npm run build`).
const distDir = path.join(__dirname, '..', 'dist', 'clothing-ui', 'browser');
app.use(express.static(distDir));

// SPA fallback for non-API routes.
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) {
      next();
    }
  });
});

// 404 + error handlers.
app.use(notFound);
app.use(errorHandler);

databaseReady.then(() => {
  app.listen(PORT, () => {
    console.log(`Monk Hagen server running at http://localhost:${PORT}`);
    startShippingWorker();
    startEmailWorker();
  });
});
