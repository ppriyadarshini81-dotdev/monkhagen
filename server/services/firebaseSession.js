const firebaseAdmin = require('../config/firebaseAdmin');
const records = new Map();
function invalidate(uid) { records.delete(uid); }
async function verifySession(user, claims) {
  if (!claims.provider) return; // Explicitly enabled legacy OTP uses database revocation only.
  if (!user.firebaseUid || claims.firebaseUid !== user.firebaseUid || !Number.isSafeInteger(claims.firebaseAuthTime) || claims.firebaseAuthTime <= 0) {
    throw Object.assign(new Error('Sign in again.'), { status: 401 });
  }
  const ttl = ['admin','super_admin'].includes(user.role) ? 15000 : 60000;
  let cached = records.get(user.firebaseUid);
  if (!cached || Date.now() - cached.checkedAt >= ttl) {
    let record;
    try { record = await firebaseAdmin.getAuth().getUser(user.firebaseUid); }
    catch (error) {
      const status = error.code === 'auth/user-not-found' ? 401 : 503;
      throw Object.assign(new Error('Sign-in verification is temporarily unavailable.'), { status });
    }
    cached = { record, checkedAt: Date.now() };
    if (records.size >= 1000) records.delete(records.keys().next().value);
    records.set(user.firebaseUid, cached);
  }
  const { record } = cached;
  const validAfter = Math.floor(new Date(record.tokensValidAfterTime || 0).getTime() / 1000);
  if (record.disabled || record.emailVerified === false || record.uid !== user.firebaseUid ||
      (record.email && record.email.toLowerCase() !== user.email?.toLowerCase()) ||
      !Number.isFinite(validAfter) || claims.firebaseAuthTime < validAfter) {
    throw Object.assign(new Error('Sign in again.'), { status: 401 });
  }
}
module.exports = { verifySession, invalidate };
