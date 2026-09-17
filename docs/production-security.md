# Security remediation deployment checks

## Database credentials and permissions

Local development may keep its existing owner connection. Production refuses
database roles that can create roles/databases, bypass RLS, create in `public`,
own application tables/sequences/schema, or inherit membership in such roles.
This guard is read-only; it does not change Neon permissions.

Before deploying:

1. In Neon, provision a separate restricted application role. Give it CONNECT
   on `monkhagen`, USAGE on `public`, SELECT/INSERT/UPDATE/DELETE on application
   tables, and USAGE/SELECT on sequences. Do not give it owner-role membership,
   CREATE, TRUNCATE, schema/table ownership, CREATEDB, CREATEROLE, SUPERUSER, or
   BYPASSRLS. Provision any role password privately in Neon, never in Git/chat.
2. Check grants inherited from PUBLIC. Revoke unwanted PUBLIC CREATE privileges
   on `public` if applicable, after checking impacts on other database users.
3. Run `npm run db:migrate` in a separate trusted migration environment whose
   `DATABASE_URL` uses the owner connection. Do not run the destructive seed.
4. Set Vercel's runtime `DATABASE_URL` to the restricted role's Neon pooled URL,
   with verified TLS. Do not expose migration credentials to the runtime.
5. Configure the existing Firebase, admin Google email, CORS, payment, shipping,
   media and SMTP environment variables privately in Vercel.

Production startup does not run migrations. Apply new migrations before starting
the new runtime version, and grant the restricted role access to new tables.
`npm run db:check` performs only a read-only connectivity/session-column check
without printing connection credentials or running migrations.

## Inventory, payments and shipping

Prepaid stock is reserved for 15 minutes. Expired reservations are released during
checkout and by the maintenance worker. Captures delivered after expiry are
still recorded as paid; insufficient stock places fulfillment on review hold.
Held orders must be reconciled by an operator before shipment. A captured-payment
hold does not itself issue a refund or cancel a remote shipment.

Legacy COD orders lacking an inventory allocation marker are held for review;
the migration does not guess stock deductions or delete those orders.
Do not clear a hold without resolving its inventory/refund/cancellation cause.

Shipping uses shared database leases with token-fenced writes, not session
advisory locks. Durable uncertain-operation intent remains in place: reconcile
Shiprocket before retrying an uncertain create/AWB/pickup/label operation.

Subscribe the Razorpay webhook to `refund.processed` as well as existing capture,
paid, and failed events. Configure the webhook secret privately. Refunds are
deduplicated by refund ID, cumulative totals cannot decrease, and refunded orders
are held from further dispatch. Already-created remote shipments require operator
reconciliation/cancellation. No automatic financial refunds are initiated.

## Rate limits and maintenance

Rate-limit counters live in PostgreSQL and are shared across instances. Database
failure fails closed; counters are not silently replaced with process-local memory.
Checkout limits use verified user identity; sign-in/contact limits use normalized
client IP. Configure trusted proxies narrowly for the actual deployment topology;
do not trust arbitrary forwarded client headers.

On Vercel, configure a scheduled invocation/worker for reservation expiry, queue
processing and expired counter cleanup. Local Node workers are not a substitute
for a Vercel scheduled job. No unauthenticated maintenance endpoint is provided.
The one-shot command `npm run security:maintenance` remains available to trusted
external workers. The new GET `/api/maintenance` endpoint requires an exact
`Authorization: Bearer <CRON_SECRET>` header, with a privately configured secret
of at least 32 characters. Missing configuration disables the endpoint. A shared
database lease prevents overlapping invocations. Each invocation handles at most
one shipping order and one email, plus bounded reservation/counter cleanup.
Configure an authenticated schedule appropriate to order volume and the hosting
plan; the code does not create or enable a Vercel schedule automatically.

## MEDIUM remediation

- Request validation rejects malformed UUIDs, nested/duplicate filters, invalid
  types, unbounded text, negative/fractional/excessive quantities and unsafe media
  URL schemes. Catalog/order/return lists use parameterized pagination, default
  100 records, maximum 100 per request; use `page` or `offset` for subsequent pages.
  Address lists are also bounded; new address creation is serialized per user and
  capped at 50 saved addresses. Account mutations are limited to 60 per 15 minutes.
- JWTs use HS256 with explicit issuer/audience, maximum one-hour customer and
  15-minute admin lifetimes. Older tokens require reauthentication. Migration
  `007_session_revocation.sql` adds a server-side session version. Successful
  `/api/auth/logout` revokes all current application sessions for that account.
  If a logout network request fails, only local logout is confirmed.
  Authentication remains bearer-based, not cookie-based; no irrelevant cookie
  CSRF middleware is added. The browser still stores its JWT in localStorage,
  which page JavaScript can read. CSP and shorter lifetimes reduce exposure but
  do not make storage immune to XSS. An HttpOnly-cookie redesign would require
  separate session/CSRF decisions and is not silently introduced here.
- Firebase session state is checked server-side with bounded caches (60 seconds
  for customers, 15 seconds for administrators). Disabled/deleted/unverified users,
  changed email bindings and revoked Firebase sessions fail closed. Legacy OTP is
  disabled in production even if its development flag is set.
- Helmet adds production CSP/HSTS and other browser headers. Development CSP is
  report-only without forced HTTPS. Google popup flows use compatible opener
  policy. Script CSP has no unsafe-inline/eval exception; inline styles remain
  permitted for Angular/checkout rendering. HTTPS media is permitted for existing
  administrator-managed product media. Vercel static headers are also configured.
  Test Google sign-in, checkout and all media on the actual deployed origin.
- Uploads are admin-only and separately rate-limited. Files are disk-backed,
  bounded in count/size, inspected by content signatures, streamed to R2 and
  stored under generated keys. HTML/SVG and MIME mismatches are rejected; this is
  not an antivirus service. Deletion is restricted to application-managed keys.
- The media proxy restricts hosts, credentials, ports and redirects; bounds time
  and streamed size; and rejects active content. Errors/logging omit SQL details,
  provider response bodies, tokens and customer data.
- Order-status transitions reject invalid skips/reversals, require payment and
  inventory proof before fulfillment, preserve delivery timestamps, and require
  AWB/pickup or return prerequisites. Manual returns/refunds still require operator
  review; these changes do not issue refunds or cancel remote shipments.

## Serverless deployment and remaining external checks

`api/index.js` reuses the Express app and pool without listening on a port,
running migrations, or starting background intervals. On Vercel, payment/COD
handlers persist durable queues instead of launching detached fulfillment work.
The authenticated maintenance invocation processes those queues synchronously.
Production role permissions must still be provisioned separately as above.

Set Vercel `NODEJS_HELPERS=0` so Express owns request parsing and signed webhook
bytes are not replaced by platform body helpers. The function refuses requests
on Vercel if this opt-out is missing. See the
[Vercel Node.js configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration).
Set production `NODE_ENV`, explicit HTTPS `CORS_ORIGINS`, Firebase/admin/JWT and
integration settings privately. Set `CRON_SECRET` for the maintenance endpoint.
Set `TRUST_PROXY` only to verified proxy IP/CIDR entries for the actual topology;
boolean, hop-count and blanket CIDR trust are rejected. Verify client-IP behavior
before relying on per-IP limits behind Vercel or another proxy.

The existing multipart UI does not bypass hosting payload limits. Vercel large
uploads require a separate reviewed upload workflow (for example, restricted
presigned R2 uploads), not larger Express limits. Confirm request size limits,
function duration, queue schedule frequency and SMTP/network availability for
the chosen hosting plan. Configure Razorpay webhook events and test their raw
signature verification on deployment. No production orders, refunds or remote
shipments are created by the regression tests.

Production readiness still requires these external checks and any unresolved
audit findings; local test success is not deployment certification.

## Verification (2026-09-17)

- Backend: 123 passed, one optional PostgreSQL integration test skipped.
- Frontend: 37 passed in ChromeHeadless.
- Production Angular build succeeded; existing CSS budget/unused-import warnings
  remain unrelated to this security work.
- `npm audit`: zero reported vulnerabilities in the installed dependency tree.
- Read-only Neon connectivity and `users.session_version` checks passed.
- `.env` remains Git-ignored and was not changed by this remediation.
