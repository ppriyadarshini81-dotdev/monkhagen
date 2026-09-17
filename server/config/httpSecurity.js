const helmet = require('helmet');
const { isIP } = require('node:net');
function configureSecurity(app, environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const project = environment.FIREBASE_PROJECT_ID;
  const authOrigin = /^[a-z0-9-]+$/.test(project || '') ? `https://${project}.firebaseapp.com` : null;
  const authOrigins = authOrigin ? [authOrigin] : [];
  app.disable('x-powered-by');
  // Default: no forwarded headers are trusted. Explicit IP/CIDR entries only.
  const proxies = (environment.TRUST_PROXY || '').split(',').map(value => value.trim()).filter(Boolean);
  if (proxies.some(value => {
    const [address, prefix, extra] = value.split('/');
    const version = isIP(address);
    return !version || extra !== undefined || prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128));
  })) {
    throw new Error('TRUST_PROXY must contain narrowly scoped proxy IP/CIDR entries, never a blanket trust setting.');
  }
  app.set('trust proxy', proxies.length ? proxies : false);
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: { reportOnly: !production, useDefaults: true, directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://apis.google.com', 'https://www.gstatic.com'],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'https:', 'data:', 'blob:'],
      'media-src': ["'self'", 'https:', 'blob:'],
      'connect-src': ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
        'https://firebaseinstallations.googleapis.com', 'https://accounts.google.com', 'https://api.razorpay.com',
        'https://checkout.razorpay.com', 'https://lumberjack.razorpay.com', ...authOrigins],
      'frame-src': ['https://checkout.razorpay.com', 'https://api.razorpay.com', 'https://accounts.google.com', ...authOrigins],
      'object-src': ["'none'"], 'base-uri': ["'self'"], 'frame-ancestors': ["'none'"],
      'form-action': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      'upgrade-insecure-requests': production ? [] : null
    } }
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
}
module.exports = { configureSecurity };
