require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/error');

const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to PostgreSQL.
connectDB();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API routes
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/upload', uploadRoutes);

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

app.listen(PORT, () => {
  console.log(`Monk Hagen server running at http://localhost:${PORT}`);
});
