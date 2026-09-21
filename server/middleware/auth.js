const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, adminGoogleEmail } = require('../config/security');
const { adminLimiter } = require('./rateLimit');
const firebaseSession = require('../services/firebaseSession');

const JWT_SECRET = jwtSecret();
const ADMIN_GOOGLE_EMAIL = adminGoogleEmail();
const ISSUER = 'monkhagen-api';
const AUDIENCE = 'monkhagen-web';
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
function expirySeconds() {
  const value = process.env.JWT_EXPIRES_IN || '1d';
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  const seconds = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]]) : MAX_TOKEN_LIFETIME_SECONDS;
  return Math.max(60, Math.min(seconds, MAX_TOKEN_LIFETIME_SECONDS));
}

function signToken(user, { provider = null, firebaseAuthTime = Math.floor(Date.now() / 1000) } = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name,
      provider, firebaseUid: provider ? user.firebaseUid : null,
      firebaseAuthTime: provider ? firebaseAuthTime : null, sessionVersion: user.sessionVersion || 0 },
    JWT_SECRET,
    { expiresIn: expirySeconds(), algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE }
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
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    const maximumLifetime = MAX_TOKEN_LIFETIME_SECONDS;
    if (!Number.isSafeInteger(decoded.iat) || !Number.isSafeInteger(decoded.exp) || decoded.exp - decoded.iat > maximumLifetime ||
        decoded.iat > Math.floor(Date.now() / 1000) + 30 || !Number.isSafeInteger(decoded.sessionVersion)) {
      return res.status(401).json({ message: 'Sign in again.' });
    }
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
    }
    if (decoded.sessionVersion !== (user.sessionVersion || 0)) return res.status(401).json({ message: 'This session has ended. Sign in again.' });
    if (decoded.role !== user.role) return res.status(403).json({ message: 'Account permissions changed. Sign in again.' });
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
    await firebaseSession.verifySession(user, decoded);
    res.set('Cache-Control', 'no-store');
    req.user = user;
    next();
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ message: 'Authentication is temporarily unavailable. Please try again.' });
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header) return next();
  return authenticate(req, res, next);
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  return adminLimiter(req, res, next);
}

module.exports = { signToken, authenticate, optionalAuthenticate, requireAdmin, JWT_SECRET };
