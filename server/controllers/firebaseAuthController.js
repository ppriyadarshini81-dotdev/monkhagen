const { getAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { adminGoogleEmail } = require('../config/security');
const analytics = require('../services/analyticsService');

// POST /api/auth/firebase
// Firebase owns customer credentials. The API receives and verifies only an ID token.
exports.firebaseLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (typeof idToken !== 'string' || !idToken.trim() || idToken.length > 8192) {
    return res.status(400).json({ message: 'Firebase ID token is required.' });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken, true);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired Firebase token.' });
  }

  const { uid, email, name, picture, email_verified: emailVerified } = decoded;
  if (!email) {
    return res.status(400).json({ message: 'Your sign-in account must have an email address.' });
  }
  if (!emailVerified) {
    return res.status(403).json({ message: 'Verify your email address before signing in.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const provider = decoded.firebase?.sign_in_provider || '';
  const configuredAdminEmail = adminGoogleEmail();
  const isConfiguredGoogleAdmin = provider === 'google.com' && normalizedEmail === configuredAdminEmail;
  if (normalizedEmail === configuredAdminEmail && !isConfiguredGoogleAdmin) {
    return res.status(403).json({ message: 'Use Google sign-in for the administrator account.' });
  }

  let user = await User.findByFirebaseUid(uid);
  let created = false;

  if (!user) {
    const existingByEmail = await User.findOne({ email: normalizedEmail });

    if (existingByEmail) {
      if (!existingByEmail.isActive) {
        return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
      }
      if (existingByEmail.firebaseUid && existingByEmail.firebaseUid !== uid) {
        return res.status(403).json({ message: 'This email is linked to a different sign-in account. Contact support.' });
      }
      const existingIsAdmin = ['admin', 'super_admin'].includes(existingByEmail.role);
      if (existingIsAdmin && !isConfiguredGoogleAdmin) {
        return res.status(403).json({ message: 'Use the administrator sign-in method for this account.' });
      }

      user = await User.linkFirebaseUid(existingByEmail.id, {
        uid,
        picture,
        name,
        emailVerified
      });
      if (isConfiguredGoogleAdmin && user.role !== 'admin') {
        user = await User.setRole(user.id, 'admin');
      }
    } else {
      created = true;
      user = await User.createFirebaseUser({
        firebaseUid: uid,
        email: normalizedEmail,
        name: name || normalizedEmail.split('@')[0],
        profileImage: picture || null,
        emailVerified: true,
        role: isConfiguredGoogleAdmin ? 'admin' : 'customer'
      });
    }
  } else {
    if (!user.isActive) {
      return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
    }
    if (user.email?.trim().toLowerCase() !== normalizedEmail ||
        (['admin', 'super_admin'].includes(user.role) && !isConfiguredGoogleAdmin)) {
      return res.status(403).json({ message: 'This sign-in account is not authorized. Contact support.' });
    }
    user = await User.updateFirebaseUser(user.id, { name, picture, emailVerified });
    if (isConfiguredGoogleAdmin && user.role !== 'admin') {
      user = await User.setRole(user.id, 'admin');
    }
  }

  if (!user?.isActive) {
    return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
  }

  res.set('Cache-Control', 'no-store');
  await analytics.recordServerEvent(req, created ? 'SIGNUP' : 'LOGIN', {
    userId: user.id,
    dedupeKey: `auth:${created ? 'signup' : 'login'}:${uid}:${decoded.auth_time || Date.now()}`
  });
  res.json({ token: signToken(user, { provider, firebaseAuthTime: decoded.auth_time || Math.floor(Date.now() / 1000) }), user: user.toJSON() });
});

// POST /api/auth/link-google
// A phone-authenticated customer must also prove ownership of the exact Google
// email before the two identities and their customer data can be joined.
exports.linkGoogleAccount = asyncHandler(async (req, res) => {
  const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
  const expectedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!idToken || idToken.length > 8192 || expectedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail)) {
    return res.status(400).json({ message: 'Enter a valid email and verify it with Google.' });
  }
  if (req.user.role !== 'customer' || !req.user.phone || !req.user.phoneVerified) {
    return res.status(403).json({ message: 'A verified mobile customer account is required.' });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken, true);
  } catch {
    return res.status(401).json({ message: 'Google verification failed. Please try again.' });
  }
  const provider = decoded.firebase?.sign_in_provider || '';
  const verifiedEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (provider !== 'google.com' || !decoded.email_verified) {
    return res.status(403).json({ message: 'Use a verified Google account to confirm this email.' });
  }
  if (verifiedEmail !== expectedEmail) {
    return res.status(403).json({ message: 'The selected Google account does not match the email you entered.' });
  }

  const user = await User.linkVerifiedGoogleAccount(req.user.id, {
    uid: decoded.uid,
    email: verifiedEmail,
    name: decoded.name || '',
    picture: decoded.picture || ''
  });
  res.set('Cache-Control', 'no-store');
  res.json({
    token: signToken(user, {
      provider: 'google.com',
      firebaseAuthTime: decoded.auth_time || Math.floor(Date.now() / 1000)
    }),
    user: user.toJSON()
  });
});
