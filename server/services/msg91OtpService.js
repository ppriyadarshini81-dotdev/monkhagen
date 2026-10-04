const SEND_OTP_URL = 'https://api.msg91.com/api/v5/otp';
const VERIFY_OTP_URL = 'https://control.msg91.com/api/v5/otp/verify';
const REQUEST_TIMEOUT_MS = 8000;

function providerError(code, message = 'OTP service is temporarily unavailable. Please try again.') {
  return Object.assign(new Error(message), { code, status: 503 });
}

function credentials() {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  const templateId = process.env.MSG91_TEMPLATE_ID?.trim();
  if (!authKey || !templateId) throw providerError('OTP_PROVIDER_NOT_CONFIGURED');
  return { authKey, templateId };
}

async function request(url, authKey, method = 'GET') {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { accept: 'application/json', authkey: authKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw providerError('OTP_PROVIDER_UNAVAILABLE');
  }

  let body;
  try { body = await response.json(); }
  catch { throw providerError('OTP_PROVIDER_INVALID_RESPONSE'); }
  return { response, body };
}

async function sendOtp(e164Phone) {
  const { authKey, templateId } = credentials();
  const mobile = e164Phone.replace(/^\+/, '');
  const url = `${SEND_OTP_URL}?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&otp_length=6`;
  const { response, body } = await request(url, authKey, 'POST');
  if (!response.ok || body?.type !== 'success') throw providerError('OTP_SEND_FAILED');
}

async function verifyOtp(e164Phone, otp) {
  const { authKey } = credentials();
  const mobile = e164Phone.replace(/^\+/, '');
  const url = `${VERIFY_OTP_URL}?otp=${encodeURIComponent(otp)}&mobile=${encodeURIComponent(mobile)}`;
  const { response, body } = await request(url, authKey);
  if (response.status >= 500) throw providerError('OTP_PROVIDER_UNAVAILABLE');
  return response.ok && body?.type === 'success';
}

module.exports = { sendOtp, verifyOtp };
