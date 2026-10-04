// Frontend delivery only. Authentication, payments and database access stay on Render.
const RENDER_ORIGIN = 'https://api.monkhagen.in';
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function failure(status, message) {
  return Response.json({ error: message }, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    // Never accept a caller-selected upstream or forward credentials through redirects.
    if (env.RENDER_API_ORIGIN !== RENDER_ORIGIN) {
      return failure(503, 'API configuration unavailable.');
    }
    const origin = request.headers.get('Origin');
    if ((origin !== null && origin !== url.origin) ||
        request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return failure(403, 'Origin not allowed.');
    }

    const upstreamUrl = new URL(RENDER_ORIGIN);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;
    const headers = new Headers(request.headers);
    // Validate browser origin above; the outgoing hop is server-to-server, not CORS.
    // This application authenticates API requests with bearer JWTs, not cookies.
    const removed = new Set([
      'origin', 'referer', 'cookie', 'host', 'content-length', 'connection',
      'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
      'transfer-encoding', 'upgrade', 'forwarded', 'x-real-ip'
    ]);
    for (const name of [...headers.keys()]) {
      if (removed.has(name) || name.startsWith('x-forwarded-') || name.startsWith('cf-')) {
        headers.delete(name);
      }
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
      // Stream JSON, multipart uploads and raw bodies unchanged; never log their contents.
      const forwarded = new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000)
      });
      const upstream = await fetch(forwarded, {
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if ((upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) ||
          upstream.headers.get('Content-Type')?.includes('text/html')) {
        await upstream.body?.cancel();
        return failure(502, 'API temporarily unavailable. Please try again.');
      }
      const responseHeaders = new Headers(upstream.headers);
      // Preserve backend security policies, including the media route's sandbox CSP.
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        if (!responseHeaders.has(name)) responseHeaders.set(name, value);
      }
      for (const name of [...responseHeaders.keys()]) {
        if (name.startsWith('access-control-')) responseHeaders.delete(name);
      }
      // Every API response is live application data except the dedicated media
      // proxy. Explicitly opt dynamic GETs out of browser/zone caching so a
      // catalogue edit cannot leave product prices stale on the storefront.
      const cacheableMedia = (request.method === 'GET' || request.method === 'HEAD') &&
        url.pathname === '/api/media';
      if (!cacheableMedia || headers.has('Authorization')) {
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('Pragma', 'no-cache');
      }
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch {
      return failure(502, 'API temporarily unavailable. Please try again.');
    }
  }
};
