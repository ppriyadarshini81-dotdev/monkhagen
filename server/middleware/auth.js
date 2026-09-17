const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, adminGoogleEmail } = require('../config/security');

const JWT_SECRET = jwtSecret();
const ADMIN_GOOGLE_EMAIL = adminGoogleEmail();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(user, { provider = null } = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name,
      provider, firebaseUid: provider === 'google.com' ? user.firebaseUid : null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Verifies the Bearer token and attaches a fresh user document to req.user.
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
    }
    // Roles come from the database, but privileged sessions must also originate
    // from verified Google sign-in for the explicitly configured identity.
    if (['admin', 'super_admin'].includes(user.role) && (
      user.email?.trim().toLowerCase() !== ADMIN_GOOGLE_EMAIL ||
      decoded.email?.trim().toLowerCase() !== ADMIN_GOOGLE_EMAIL ||
      decoded.provider !== 'google.com' || !user.firebaseUid ||
      decoded.firebaseUid !== user.firebaseUid
    )) {
      return res.status(403).json({ message: 'Sign in with the designated administrator Google account.' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
}

module.exports = { signToken, authenticate, requireAdmin, JWT_SECRET };
