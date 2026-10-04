const INDIAN_MOBILE = /^[6-9]\d{9}$/;

function normalizeIndianMobile(value) {
  if (typeof value !== 'string') return null;
  let digits = value.trim().replace(/[\s()-]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return INDIAN_MOBILE.test(digits) ? digits : null;
}

function toE164Indian(value) {
  const national = normalizeIndianMobile(value);
  return national ? `+91${national}` : null;
}

function phoneRateLimitKey(value) {
  return `phone:${normalizeIndianMobile(value) || 'invalid'}`;
}

module.exports = { INDIAN_MOBILE, normalizeIndianMobile, toE164Indian, phoneRateLimitKey };
