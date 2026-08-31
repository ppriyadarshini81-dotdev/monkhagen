const { getAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// POST /api/auth/google
// Angular sends a Firebase ID token; the backend verifies it and assigns roles.
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

  const normalizedEmail = email.toLowerCase();
  const configuredAdminEmail = (
    process.env.ADMIN_GOOGLE_EMAIL || 'officialmail.monkhagen@gmail.com'
  ).trim().toLowerCase();
  const isConfiguredAdmin = normalizedEmail === configuredAdminEmail;

  if (isConfiguredAdmin && !email_verified) {
    return res.status(403).json({ message: 'The administrator Google email must be verified.' });
  }

  let user = await User.findByGoogleUid(uid);

  if (!user) {
    let existingByEmail = await User.findOne({ email: normalizedEmail });

    if (existingByEmail) {
      if (['admin', 'super_admin'].includes(existingByEmail.role) && !email_verified) {
        return res.status(403).json({ message: 'The administrator Google email must be verified.' });
      }

      if (isConfiguredAdmin && !['admin', 'super_admin'].includes(existingByEmail.role)) {
        existingByEmail = await User.setRole(existingByEmail.id, 'admin');
      }

      user = await User.linkGoogleUid(existingByEmail.id, { uid, picture, name });
    } else {
      user = await User.createGoogleUser({
        googleUid: uid,
        email: normalizedEmail,
        name: name || email.split('@')[0],
        profileImage: picture || null,
        emailVerified: email_verified || false,
        role: isConfiguredAdmin ? 'admin' : 'customer'
      });
    }
  } else {
    user = await User.updateGoogleUser(user.id, { name, picture });
    if (isConfiguredAdmin && !['admin', 'super_admin'].includes(user.role)) {
      user = await User.setRole(user.id, 'admin');
    }
  }

  res.json({ token: signToken(user), user: user.toJSON() });
});
