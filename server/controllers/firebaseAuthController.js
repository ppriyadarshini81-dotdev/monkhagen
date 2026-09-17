const { getAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { adminGoogleEmail } = require('../config/security');

// POST /api/auth/firebase
// Firebase owns customer credentials. The API receives and verifies only an ID token.
exports.firebaseLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (typeof idToken !== 'string' || !idToken.trim()) {
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

  res.json({ token: signToken(user, { provider }), user: user.toJSON() });
});
