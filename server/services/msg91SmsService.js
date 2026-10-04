const SEND_SMS_URL = 'https://control.msg91.com/api/v5/flow';
const REQUEST_TIMEOUT_MS = 8000;

function providerError(code) {
  return Object.assign(new Error('Transactional SMS service is temporarily unavailable.'), { code, status: 503 });
}

function createMsg91SmsClient({ environment = process.env, fetchImpl = global.fetch } = {}) {
  async function sendTemplate({ mobile, templateId, senderId, variables }) {
    const authKey = environment.MSG91_AUTH_KEY?.trim();
    if (!authKey || !templateId) throw providerError('SMS_PROVIDER_NOT_CONFIGURED');

    let response;
    try {
      response = await fetchImpl(SEND_SMS_URL, {
        method: 'POST',
        headers: { accept: 'application/json', authkey: authKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          sender: senderId,
          short_url: '0',
          realTimeResponse: '1',
          recipients: [{ mobiles: mobile, ...variables }]
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw providerError('SMS_PROVIDER_UNAVAILABLE');
    }

    let body;
    try { body = await response.json(); }
    catch { throw providerError('SMS_PROVIDER_INVALID_RESPONSE'); }
    if (!response.ok || body?.type !== 'success') throw providerError('SMS_SEND_FAILED');
    return String(body.message || '').replace(/[\r\n]/g, '').slice(0, 255) || null;
  }

  return { sendTemplate };
}

module.exports = { ...createMsg91SmsClient(), createMsg91SmsClient, SEND_SMS_URL };
