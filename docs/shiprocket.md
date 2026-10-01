# Monk Hagen backend shipping integration

The Angular application calls Monk Hagen's authenticated `/api/shipping` endpoints. Only the backend contacts Shiprocket. There is no public Shiprocket login endpoint, and Shiprocket credentials/tokens are never included in API responses or stored in PostgreSQL.

## Configuration

Set these backend environment variables locally. Variable names only are listed here; do not add credentials to Angular or commit `.env`.

| Variable | Purpose |
| --- | --- |
| `SHIPROCKET_EMAIL` | Shiprocket API-user login |
| `SHIPROCKET_PASSWORD` | Shiprocket API-user password |
| `SHIPROCKET_BASE_URL` | Documented Shiprocket API origin; defaults to the official HTTPS origin when blank |
| `SHIPROCKET_TIMEOUT_MS` | Optional request/body timeout, defaults to 15 seconds; accepted range 1–60 seconds |
| `SHIPROCKET_PICKUP_LOCATION` | Exact name of an existing pickup location in your Shiprocket account |
| `SHIPROCKET_PACKAGE_WEIGHT_KG` | Actual packed-order weight in kilograms |
| `SHIPROCKET_PACKAGE_LENGTH_CM` | Packed-order length in centimetres |
| `SHIPROCKET_PACKAGE_BREADTH_CM` | Packed-order breadth in centimetres |
| `SHIPROCKET_PACKAGE_HEIGHT_CM` | Packed-order height in centimetres |
| `SHIPROCKET_WEBHOOK_SECRET` | Strong private value configured as Shiprocket's tracking webhook `x-api-key` |

Existing `DB_*`, `JWT_*`, `RAZORPAY_*`, and `SMTP_*` configuration is reused. No new npm packages are required: the integration uses Node's native `fetch`, `AbortController`, and test runner, plus the existing `pg`, Express, and rate limiter.

Restart the backend after setting `.env`. Package defaults describe **one entire packed order**, not one product. Only configure automatic defaults if they accurately describe the orders you fulfill. Otherwise leave them blank and supply measurements per order through the admin create-shipment request. No guessed warehouse name or measurements are used.

## Database and startup

`server/migrations/001_shipments.sql` adds `shipments`. `server/config/db.js` records it in `schema_migrations` and applies it transactionally under an advisory migration lock. The file is repeatable and can also be applied through your normal PostgreSQL migration tooling. Startup waits for pending migrations before listening or processing shipping work; completed migrations are skipped on later starts.

The table stores:

- One unique `order_id` referencing `orders`, with unique Shiprocket order/shipment IDs and AWB.
- Courier, shipment/tracking status, label/tracking URLs, provider shipping charge, delivery estimate, pickup status/date.
- Pickup location and actual package weight/dimensions used in creation.
- Pending operation, attempt count, retry time, sanitized error code, tracking cache/events, and timestamps.

`order_id` uses `ON DELETE RESTRICT` so a shipped order cannot accidentally lose its mapping. No existing rows are deleted, reset, or backfilled into shipments. Do not run the existing destructive seed script as part of shipping setup.

`server/migrations/009_returns_workflow.sql` extends the existing return tables with item-level idempotency, reverse-shipment identifiers, pickup state, refund state, and webhook deduplication. `server/migrations/010_return_item_comments.sql` safely repairs the return-item comments column for databases that recorded an earlier revision of migration 009. Apply pending migrations through `npm run db:migrate` before deploying the API changes. Production API startup intentionally does not apply migrations.

Existing `orders.awb_number`, `courier_name`, and `tracking_url` fields are synchronized when available. Tracking refreshes also record provider pickup/delivery dates; confirmed delivery can advance an order to `delivered` without overwriting cancelled/returned states. Pickup scheduling alone does not mark the order shipped. The existing account endpoints continue to read these fields.

## Payment and fulfillment sequence

1. Razorpay checkout verification validates the signature and fetches a captured payment from Razorpay. Signed paid webhooks must also contain captured payment details with amount/currency.
2. In one PostgreSQL transaction, payment becomes paid, inventory is deducted, the cart is converted, and a shipment work item is inserted.
3. Only after commit does the backend attempt Shiprocket order creation. A worker checks queued work every 30 seconds, including after a restart.
4. Missing package configuration, invalid provider authentication, or denied API-user permissions leave `needs_configuration` and require a controlled admin retry after correction. Other safe-to-retry provider failures leave `retry_pending`; retry is delayed five minutes. Saved-order validation failures leave `validation_failed` for admin correction/retry.
5. Admin selects a courier using serviceability information, assigns AWB, generates pickup, and generates the label. These operations are intentionally explicit, not automatically booked by the payment callback.

The application already supports COD through `POST /api/orders`, although the current cart UI uses Razorpay. This endpoint now explicitly accepts only COD and queues its shipment inside order creation. This integration does not add a COD frontend option. Prepaid requests must go through Razorpay; frontend `paymentStatus`/`paid` values are ignored by shipping.

The legacy COD checkout's stock handling is unchanged: it checks stock but does not reserve/deduct it. Automatic COD shipment creation therefore does not replace inventory review for COD fulfillment.

## Endpoints

All requests use `Authorization: Bearer <Monk Hagen JWT>` (never a Shiprocket token). JSON POST requests use `Content-Type: application/json`. Shipping endpoints are limited to 30 requests per minute per IP.

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/shipping/serviceability` | Authenticated user |
| POST | `/api/shipping/create-shipment` | Admin / super admin |
| POST | `/api/shipping/:orderId/assign-awb` | Admin / super admin |
| POST | `/api/shipping/:orderId/generate-pickup` | Admin / super admin |
| POST | `/api/shipping/:orderId/generate-label` | Admin / super admin |
| GET | `/api/shipping/:orderId/tracking` | Order owner or admin / super admin |
| POST | `/api/shipping/:orderId/reconcile` | Admin / super admin; recovery only |

### Returns and reverse pickup

Customers request a return from an eligible delivered order in **My Orders**. Eligibility is calculated from the persisted `delivered_at` timestamp and closes exactly seven days later. Refund amounts use the original order-item snapshots and allocate the original order discount in integer paise; delivery and COD charges are excluded.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/account/orders/:orderId/return-eligibility` | Order owner |
| POST | `/api/account/returns` | Order owner; requires an idempotency key |
| GET | `/api/account/returns` | Customer's returns |
| GET | `/api/account/returns/:returnId` | Return owner |
| GET | `/api/admin/returns` | Admin / super admin |
| POST | `/api/admin/returns/:returnId/retry-creation` | Admin / super admin; only after a definitive provider failure |
| POST | `/api/admin/returns/:returnId/approve` | Admin / super admin; only after warehouse receipt |
| POST | `/api/admin/returns/:returnId/reject` | Admin / super admin; stage-aware reject or cancellation |
| POST | `/api/admin/returns/:returnId/refund` | Admin / super admin |
| POST | `/api/webhooks/tracking-updates` | Shiprocket, authenticated by `x-api-key` |

The backend creates a return order with Shiprocket's `/orders/create/return` API only. It does not assign a courier, generate an AWB, or schedule pickup; a Monk Hagen administrator performs those actions from Shiprocket's **New** returns tab. Shiprocket's **Pending Requests** tab is reserved for requests submitted through Shiprocket's own tracking page and has no documented external request-creation API. The customer's immutable order-address snapshot is the pickup address. Before creating the return order, the backend reads Shiprocket's saved pickup locations and requires one exact match for `SHIPROCKET_PICKUP_LOCATION`; that saved location's name, address, city, state, country, pincode, email, and phone become the return destination. The application never creates or updates a Shiprocket location. Before pickup, the admin reject action cancels a known Shiprocket return through `/orders/cancel` before marking it cancelled locally. An uncertain cancellation remains pending reconciliation, and a return that may have been created without a saved provider ID requires explicit confirmation that no matching Shiprocket return exists. Cancellation is unavailable after pickup. After warehouse receipt, rejection is a local inspection decision and does not restore inventory or issue a refund. Inventory is restored once, only when an administrator approves a return whose tracking state is `received`. Prepaid refunds are submitted to Razorpay and become complete only after the signed Razorpay refund webhook is processed. COD refunds are marked for manual handling and are never sent to Razorpay.

Configure Shiprocket's tracking webhook URL as `https://<api-host>/api/webhooks/tracking-updates` and set its token/header value to exactly `SHIPROCKET_WEBHOOK_SECRET`. Use a long random secret, keep it backend-only, and rotate it if disclosed. A timeout or malformed response during reverse-shipment creation is treated as an uncertain result: review the return in Shiprocket before any manual intervention so a duplicate pickup is not booked.

`orderId` is the internal PostgreSQL UUID. Provider IDs are returned on admin shipment responses, commonly as strings because PostgreSQL stores them as BIGINT. Successful repeated admin operations return the saved result with HTTP 200.

### Sample Postman requests

Import `docs/shiprocket.postman_collection.json` and set its local variables. `token` is a Monk Hagen application JWT obtained through the existing login flow. Do not share/export a collection containing actual tokens. The example addresses/dimensions below are test input, not production defaults.

**Serviceability** — `POST {{baseUrl}}/api/shipping/serviceability`

```json
{
  "pickup_postcode": "110001",
  "delivery_postcode": "560001",
  "weight": 0.5,
  "cod": false
}
```

Returns `{ available, currency, couriers }`. Each courier includes `courierId`, `courierName`, `estimatedDelivery`, `estimatedDeliveryDays`, `freightCharge`, `shippingCharge`, `codAvailable`, `codCharge`, and `rating`. Missing provider fields are null. An empty courier array means no availability. Quotes do not alter the already-paid order total or the existing flat checkout shipping policy.

**Create/retry a shipment** — `POST {{baseUrl}}/api/shipping/create-shipment`

```json
{ "orderId": "{{orderId}}" }
```

With per-order admin measurements:

```json
{
  "orderId": "{{orderId}}",
  "pickup_location": "{{pickupLocation}}",
  "weight": 0.5,
  "length": 25,
  "breadth": 20,
  "height": 5
}
```

Customer data, item prices, quantities, addresses and payment method come exclusively from the saved order. There is one address snapshot, so it is used as both billing and shipping. SKU falls back to the saved variant UUID/item UUID where a SKU is absent. Timestamps are formatted in India time. Only domestic Indian shipments are implemented.

**Assign the selected courier** — `POST {{baseUrl}}/api/shipping/{{orderId}}/assign-awb`

```json
{ "courier_id": 43 }
```

Use a courier ID returned for the actual route, weight and COD flag. Shiprocket validates assignment; an existing AWB cannot be reassigned through this endpoint. Provider charges/estimates are persisted when returned, otherwise remain null; they are not fabricated from customer-paid shipping fees.

**Generate pickup** — `POST {{baseUrl}}/api/shipping/{{orderId}}/generate-pickup`

```json
{}
```

**Generate label** — `POST {{baseUrl}}/api/shipping/{{orderId}}/generate-label`

```json
{}
```

**Tracking** — `GET {{baseUrl}}/api/shipping/{{orderId}}/tracking`

Returns shipment status, AWB, courier, tracking URL, estimated delivery, pickup status, normalized events, and last-check time. Shiprocket tracking is fetched at most once per minute per order when requested. No provider auth data, customer addresses or label links are included. An unassigned shipment returns its local state without a remote call. Other customers receive 404. Forward-shipment tracking remains user-triggered through this endpoint; the tracking webhook described above advances reverse-return state only.

## Duplicate prevention and recovery

- The local order UUID is always Shiprocket's `order_id` (channel order reference); it never changes on retry.
- A PostgreSQL unique constraint allows one shipment per internal order. A per-order advisory lock serializes all operations across backend processes.
- The backend commits `pending_operation` before sending a provider mutation. A network timeout, malformed success, interrupted process, or failed local save leaves that marker. The worker will **not** resend such a mutation.
- A second operation on a marked shipment returns `SHIPPING_RECONCILIATION_REQUIRED`. HTTP errors with uncertain outcomes (including duplicate/422 responses) are treated conservatively. No absolute distributed exactly-once guarantee is claimed.

To recover, find the order in Shiprocket by the internal order UUID, then call:

`POST {{baseUrl}}/api/shipping/{{orderId}}/reconcile`

```json
{ "shiprocket_order_id": "{{shiprocketOrderId}}" }
```

The backend fetches Shiprocket order details and verifies `channel_order_id` matches the internal UUID before saving provider IDs. A supplied frontend status is never used. AWB/pickup recovery additionally requires remote evidence of that operation; if the details endpoint does not confirm pickup, keep the shipment blocked and resolve it with Shiprocket support. Label regeneration after reconciliation is safe because it only generates a document. If no remote order exists, have an operator verify the failed request with Shiprocket before repairing the local operation marker; there is deliberately no blind force-retry API.

Administrator database inspection (read-only):

```sql
SELECT order_id, shiprocket_order_id, shiprocket_shipment_id, shipping_status,
       pending_operation, last_error_code, attempt_count, next_attempt_at
FROM shipments
WHERE shiprocket_order_id IS NULL OR pending_operation IS NOT NULL
ORDER BY created_at;
```

## Testing sequence

1. Run `npm run test:shipping`. These tests mock Shiprocket, Razorpay and email and cannot book live shipments.
2. Run the optional PostgreSQL test with `SHIPPING_DB_TESTS=1`. It creates a unique schema inside a transaction and rolls everything back; it does not reset application data. PowerShell: `$env:SHIPPING_DB_TESTS = '1'; node server/tests/shippingDatabase.test.js`.
3. Configure the backend Shiprocket API user, pickup location and real package measurements. Restart with `npm run dev`. Confirm `/api/health` and the `shipments` table.
4. Sign in through the existing login flow. Check serviceability with actual origin/destination, including an unsupported route and both COD values.
5. With an unpaid Razorpay order, confirm admin shipment creation returns 409 and creates no provider order. Verify invalid signatures/failed payments create no shipment work item.
6. Complete a controlled Razorpay payment. Check `orders.payment_status`, `paid_at`, and the matching shipment row. Exercise the signed webhook path too; repeated verified callbacks must retain the same provider IDs.
7. Repeat create-shipment for the same order and confirm it returns the same IDs. Test a missing package configuration and then an admin retry with correct measurements.
8. Select an available courier, assign AWB, generate pickup, and generate a label. Repeat each and confirm the saved result is reused. These calls can book a real courier pickup and incur account charges; use an order you intend to fulfill.
9. Track as the owning customer, another customer, and an administrator. Check that no provider token/credentials appear in responses or logs.
10. Use automated mocks to exercise timeout/authentication failures and reconciliation. Do not simulate failures by repeatedly booking real shipments.

No live provider credentials were used during implementation. Live serviceability, account-specific pickup configuration, wallet/courier eligibility and end-to-end fulfillment still require the configuration and controlled sequence above.

## Files

The fulfillment integration is centered on `server/config/shiprocket.js`, `server/models/Shipment.js`, `server/services/shippingService.js`, and `server/services/shippingWorker.js`. Reverse logistics is implemented in `server/services/returnService.js`, the account/admin return controllers and routes, and `server/migrations/009_returns_workflow.sql`. Backend configuration lives only in private environment settings; do not commit provider credentials or webhook secrets.

References: [Shiprocket official API documentation](https://apidocs.shiprocket.in/), [official Postman collection](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/documentation/qu05zax/shiprocket-api), [official authentication/API helpsheet](https://shiprocket.freshdesk.com/support/solutions/articles/43000337456-api-document-helpsheet).
