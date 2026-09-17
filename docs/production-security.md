# HIGH security remediation deployment checks

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
The one-shot command `npm run security:maintenance` can be used by a trusted
external worker with restricted runtime credentials. A Vercel HTTP cron function
still needs a separately configured, authenticated invocation path.

These changes do not resolve the remaining MEDIUM audit findings. Complete their
remediation and deployment configuration before treating the app as production-ready.
