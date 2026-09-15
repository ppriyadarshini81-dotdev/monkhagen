const { getAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/auth/firebase
// Firebase owns customer credentials. The API receives and verifies only an ID token.
exports.firebaseLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ message: 'Firebase ID token is required.' });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
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
  const configuredAdminEmail = (
    process.env.ADMIN_GOOGLE_EMAIL || 'officialmail.monkhagen@gmail.com'
  ).trim().toLowerCase();
  const isConfiguredGoogleAdmin = provider === 'google.com' && normalizedEmail === configuredAdminEmail;

  let user = await User.findByFirebaseUid(uid);

  if (!user) {
    const existingByEmail = await User.findOne({ email: normalizedEmail });

    if (existingByEmail) {
      const existingIsAdmin = ['admin', 'super_admin'].includes(existingByEmail.role);
      if (existingIsAdmin && !isConfiguredGoogleAdmin) {
        return res.status(403).json({ message: 'Use the administrator sign-in method for this account.' });
      }

      if (isConfiguredGoogleAdmin && !existingIsAdmin) {
        await User.setRole(existingByEmail.id, 'admin');
      }

      user = await User.linkFirebaseUid(existingByEmail.id, {
        uid,
        picture,
        name,
        emailVerified
      });
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
    user = await User.updateFirebaseUser(user.id, { name, picture, emailVerified });
    if (isConfiguredGoogleAdmin && !['admin', 'super_admin'].includes(user.role)) {
      user = await User.setRole(user.id, 'admin');
    }
  }

  if (!user?.isActive) {
    return res.status(403).json({ message: 'This account is unavailable. Contact support.' });
  }

  res.json({ token: signToken(user), user: user.toJSON() });
});
