# Cloudflare frontend deployment

Angular is a static SPA on Cloudflare Workers. Express and all database, authentication,
payment, shipping, storage and email integrations remain on Render. This configuration
does not deploy the Express application to Cloudflare or change Razorpay mode.

## GitHub deployment screen

| Field | Value |
| --- | --- |
| Repository | `monkhagen` |
| Production branch | `main` |
| Project/Worker name | `monkhagen` |
| Path/root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build output directory (in Wrangler) | `dist/clothing-ui/browser` |
| Build variable | `NODE_VERSION=24` |
| Cloudflare Access | Off for the public storefront |
| Non-production branch builds | Off until an isolated preview backend is configured |

Wrangler is pinned in development dependencies and requires Node 22 or newer. Do not
set `NODE_ENV=production` during dependency installation: the Angular builder and
Wrangler are development dependencies needed for the build. Cloudflare installs
dependencies using the lockfile before the build command.

Keep the automatically created deployment token private (a label such as
`monkhagen-deploy` is sufficient). Do not add database URLs, Firebase private keys,
JWT secrets, Razorpay secrets, R2 credentials, shipping credentials or SMTP passwords
to this frontend project. Those remain in Render. The only Worker variable is the
public Render API origin, `https://api.monkhagen.in`, already declared in `wrangler.jsonc`.

These repository changes must reach the GitHub `main` branch before Cloudflare can
use them. Creating these files locally does not commit, push or deploy them.

## Routing and API requests

`wrangler.jsonc` serves only the browser build directory, with SPA fallback for direct
navigation/refresh on existing Angular routes. `/api` and `/api/*` always run the
frontend proxy, never return Angular's HTML fallback. Angular services and the bearer
token interceptor keep their existing same-origin `/api` URLs. `proxy.conf.json` is
only for `ng serve` locally; it is not used by Cloudflare.

The proxy forwards to the fixed HTTPS Render custom domain `https://api.monkhagen.in`, preserves bearer authorization,
streams request/response bodies, does not follow redirects, and does not edge-cache
API responses. Public media's browser cache/ETag headers remain intact; authenticated
requests and mutations are marked `no-store`. Browser origins must match the frontend
origin. After validation the Origin header is removed from the server-to-server hop,
so no Render CORS change is required. This does not replace backend authentication,
role checks, ownership checks, validation or payment signature checks.

Angular still calls relative `/api` URLs, not the custom API domain directly:
`/api/products` on the frontend is forwarded to `https://api.monkhagen.in/api/products`.
Do not append `/api` to `RENDER_API_ORIGIN`; the request path already includes it.
Update the fixed origin in `cloudflare/worker.mjs` together with the Wrangler variable.

With `NODE_ENV=production`, Render serves only the API: GET `/` returns
`{"status":"ok","service":"Monk Hagen API"}`, and `/api/health` keeps its existing
JSON response. Other non-API paths return JSON 404 rather than Angular HTML. Express
retains its existing static-file/SPA fallback outside production; the localhost
Angular development proxy is unchanged. No Angular build is needed on Render.

Security headers for static assets are copied from `public/_headers`. API responses
retain Render's headers; proxy failures use generic errors without internal details.
No backend module or local `.env` is bundled into the Worker.

## Checks before public launch

1. Add the exact deployed frontend hostname (without protocol or path) to Firebase
   Authentication > Settings > Authorized domains. Also add intended custom domains.
   Check Firebase email action/continue URLs for the actual frontend domain.
2. Open the deployed `/api/health`; expect JSON, not the Angular page. Check products,
   media, Google login, email verification/login, cart, addresses and admin operations.
3. Directly open/refresh existing routes such as `/products`, `/cart` and
   `/account/profile`. `/collection`, top-level `/profile` and `/checkout` are not
   currently Angular routes; checkout is a modal.
4. Test Razorpay in its current test mode, including webhook reconciliation. Existing
   webhook destinations stay on Render; do not move callbacks to Cloudflare.
5. Check CSP violations and authentication popup behavior in the browser console.
6. Validate rate limiting with multiple users. Render may identify shared proxy IPs
   depending on its existing trusted-proxy configuration. No trust-proxy setting was
   changed here; do not solve this by blindly trusting client forwarding headers.
7. Test admin uploads against Cloudflare request-size/time limits. Large videos may
   need a separately reviewed upload design; this proxy adds no direct R2 credentials.

## Local verification (does not deploy)

```sh
npm run test:cloudflare
npm run build
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

Production provider integration checks still require the deployed domain; mocked
tests and a dry run do not prove Firebase, Render or Razorpay works end-to-end.

References: [Worker assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/),
[SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
[static security headers](https://developers.cloudflare.com/workers/static-assets/headers/).
