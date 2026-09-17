function adminGoogleEmail(environment = process.env) {
  const email = environment.ADMIN_GOOGLE_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_GOOGLE_EMAIL must contain the designated administrator email.');
  }
  return email;
}

function jwtSecret(environment = process.env) {
  const configured = environment.JWT_SECRET?.trim();
  if (!configured || configured.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }
  return configured;
}

function allowedCorsOrigins(environment = process.env) {
  const configured = (environment.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length) {
    for (const origin of configured) {
      let url;
      try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain valid origins only.'); }
      if (url.origin !== origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol) ||
          environment.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
        throw new Error('Production CORS origins must use HTTPS; wildcard, credentialed and localhost origins are forbidden.');
      }
    }
    return configured;
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGINS must contain at least one allowed origin in production.');
  }
  return ['http://localhost:4200', 'http://127.0.0.1:4200'];
}

function legacyOtpEnabled(environment = process.env) {
  return environment.NODE_ENV !== 'production' && environment.ENABLE_LEGACY_OTP === 'true';
}

function developmentOtpCode(environment = process.env) {
  if (environment.NODE_ENV === 'production') return null;
  const code = environment.DEV_OTP_CODE?.trim();
  return /^\d{6}$/.test(code || '') ? code : null;
}

module.exports = {
  adminGoogleEmail,
  allowedCorsOrigins,
  developmentOtpCode,
  jwtSecret,
  legacyOtpEnabled
};
