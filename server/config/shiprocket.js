const TOKEN_LIFETIME_MS = 10 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function shippingError(status, code, message, uncertain = false) {
  const error = new Error(message);
  Object.assign(error, { status, code, uncertain });
  return error;
}

// Neither credentials, raw responses, nor request headers belong in logs/errors.
function providerError(status, code, uncertain = false) {
  console.error('Shiprocket request failed:', { status, code });
  return shippingError(status === 401 || status === 403 ? 503 : status === 504 ? 504 : 502,
    code, code === 'SHIPROCKET_AUTH_FAILED'
      ? 'Shipping authentication failed. Contact the store administrator.'
      : code === 'SHIPROCKET_PERMISSION_DENIED'
        ? 'Shiprocket denied shipment creation. Check the API user permissions and account status.'
      : 'The shipping provider could not complete this request. Please try again later.', uncertain);
}

function getConfig(env = process.env) {
  if (!env.SHIPROCKET_EMAIL || !env.SHIPROCKET_PASSWORD) {
    throw shippingError(503, 'SHIPROCKET_NOT_CONFIGURED', 'Shipping service is not configured.');
  }
  let base;
  try { base = new URL(env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in'); }
  catch { throw shippingError(503, 'SHIPROCKET_NOT_CONFIGURED', 'Shipping service URL is invalid.'); }
  // Only the documented origin can receive these credentials; do not follow redirects.
  if (base.origin !== 'https://apiv2.shiprocket.in' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw shippingError(503, 'SHIPROCKET_NOT_CONFIGURED', 'Shipping service URL is invalid.');
  }
  const timeout = Number(env.SHIPROCKET_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60000) {
    throw shippingError(503, 'SHIPROCKET_NOT_CONFIGURED', 'Shipping timeout configuration is invalid.');
  }
  return { baseUrl: base.origin, email: env.SHIPROCKET_EMAIL, password: env.SHIPROCKET_PASSWORD, timeout };
}

function createShiprocketClient({ fetchImpl = (...args) => fetch(...args), now = Date.now,
  config = () => getConfig() } = {}) {
  let token;
  let expiresAt = 0;
  let loginPromise;

  async function send(path, { method = 'GET', body, query, authToken } = {}) {
    const settings = config();
    const url = new URL(`/v1/external${path}`, settings.baseUrl);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeout);
    const mutation = method !== 'GET' && path !== '/auth/login';
    try {
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      // Consume the body inside the timeout as well. Never expose the provider's error text.
      let data;
      try { data = await response.json(); }
      catch {
        if (controller.signal.aborted) throw providerError(504, 'SHIPROCKET_TIMEOUT', mutation);
        if (response.status === 401) return { status: 401, data: null };
        throw providerError(502, 'SHIPROCKET_INVALID_RESPONSE', mutation);
      }
      if (response.status === 401) return { status: 401, data: null };
      if (!response.ok) {
        const code = response.status === 403 && path !== '/auth/login'
          ? 'SHIPROCKET_PERMISSION_DENIED'
          : 'SHIPROCKET_REQUEST_FAILED';
        const error = providerError(response.status, code,
          mutation && (response.status >= 500 || [408, 409, 422].includes(response.status)));
        error.upstreamStatus = response.status;
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw providerError(502, 'SHIPROCKET_INVALID_RESPONSE', mutation);
      }
      if (data.status === false || data.success === false || Number(data.status_code) >= 400) {
        throw providerError(502, 'SHIPROCKET_REQUEST_FAILED', mutation);
      }
      return { status: response.status, data };
    } catch (error) {
      if (error.code?.startsWith('SHIPROCKET_')) throw error;
      throw providerError(controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? 'SHIPROCKET_TIMEOUT' : 'SHIPROCKET_UNAVAILABLE', mutation);
    } finally {
      clearTimeout(timer);
    }
  }

  async function authenticate() {
    if (token && now() < expiresAt - REFRESH_MARGIN_MS) return token;
    if (!loginPromise) {
      loginPromise = (async () => {
        const settings = config();
        let result;
        try {
          result = await send('/auth/login', { method: 'POST',
            body: { email: settings.email, password: settings.password } });
        } catch (error) {
          if (error.code === 'SHIPROCKET_NOT_CONFIGURED') throw error;
          throw providerError(401, 'SHIPROCKET_AUTH_FAILED');
        }
        if (result.status === 401 || typeof result.data?.token !== 'string' || !result.data.token) {
          throw providerError(401, 'SHIPROCKET_AUTH_FAILED');
        }
        token = result.data.token;
        expiresAt = now() + TOKEN_LIFETIME_MS;
        try {
          const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
          if (Number.isFinite(claims.exp)) expiresAt = Math.min(expiresAt, claims.exp * 1000);
        } catch { /* Opaque tokens use the documented ten-day lifetime. */ }
        if (expiresAt <= now() + REFRESH_MARGIN_MS) {
          token = null;
          throw providerError(401, 'SHIPROCKET_AUTH_FAILED');
        }
        return token;
      })().finally(() => { loginPromise = null; });
    }
    return loginPromise;
  }

  return {
    async request(path, options = {}) {
      let usedToken = await authenticate();
      let result = await send(path, { ...options, authToken: usedToken });
      if (result.status === 401) {
        if (token === usedToken) { token = null; expiresAt = 0; }
        usedToken = await authenticate();
        result = await send(path, { ...options, authToken: usedToken });
        if (result.status === 401) throw providerError(401, 'SHIPROCKET_AUTH_FAILED');
      }
      return result.data;
    }
  };
}

module.exports = { shiprocket: createShiprocketClient(), createShiprocketClient, shippingError, getConfig };
