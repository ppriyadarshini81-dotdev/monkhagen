const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let initialized = false;

// Only initialize if credentials are present — server starts cleanly without them
if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  if (!getApps().length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      })
    });
  }
  initialized = true;
} else {
  console.warn('[firebase-admin] FIREBASE_* env vars not set — Google login will be unavailable.');
}

module.exports = {
  // Returns getAuth() only when configured; throws a clear error otherwise
  getAuth: () => {
    if (!initialized) {
      const err = new Error('Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.');
      err.status = 503;
      throw err;
    }
    return getAuth();
  }
};
