const { getAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/auth/google
// Angular sends a Firebase ID token; we verify it and return our own JWT.
exports.googleLogin = asyncHandler(async (req, res) => {
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

  const { uid, email, name, picture, email_verified } = decoded;

  if (!email) {
    return res.status(400).json({ message: 'Google account must have an email address.' });
  }

  // 1. Try to find by google_uid (fastest path for returning users)
  let user = await User.findByGoogleUid(uid);

  if (!user) {
    const existingByEmail = await User.findOne({ email: email.toLowerCase() });

    if (existingByEmail) {
      // Block Google login for admin / super_admin accounts
      if (['admin', 'super_admin'].includes(existingByEmail.role)) {
        return res.status(403).json({
          message: 'This email belongs to an admin account. Use email + password to sign in.'
        });
      }
      // Link google_uid to existing customer account
      user = await User.linkGoogleUid(existingByEmail.id, { uid, picture, name });
    } else {
      // New customer — backend assigns the role, never trusted from client
      user = await User.createGoogleCustomer({
        googleUid: uid,
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        profileImage: picture || null,
        emailVerified: email_verified || false
      });
    }
  } else {
    // Returning user — refresh profile and last_login_at
    user = await User.updateGoogleUser(user.id, { name, picture });
  }

  res.json({ token: signToken(user), user: user.toJSON() });
});
