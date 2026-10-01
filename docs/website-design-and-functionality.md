# Monk Hagen — Website Design and Functionality

**Document date:** 17 September 2026  
**Code baseline:** `19d81ee` on `development`  
**Audience:** business owner, developers, testers and deployment operators  
**Scope:** implemented website, high-level design, low-level design, module functionality, integrations, development history and production handover.

This document describes the repository at the baseline above, not a proposed system. “Implemented” means code exists; it does not certify that a live provider account, production deployment or every end-to-end scenario has been tested. Credentials, private keys and connection-string values are intentionally omitted.

## Contents

1. [Business scope and implementation status](#1-business-scope-and-implementation-status)
2. [High-level design](#2-high-level-design)
3. [Low-level design](#3-low-level-design)
4. [Module-wise functionality](#4-module-wise-functionality)
5. [Database design](#5-database-design)
6. [API reference](#6-api-reference)
7. [External integrations](#7-external-integrations)
8. [Security design and hardening](#8-security-design-and-hardening)
9. [Performance and caching](#9-performance-and-caching)
10. [Configuration, development and operations](#10-configuration-development-and-operations)
11. [Testing and acceptance](#11-testing-and-acceptance)
12. [Production deployment checklist](#12-production-deployment-checklist)
13. [Development history](#13-development-history)
14. [Known limitations and future work](#14-known-limitations-and-future-work)
15. [Source-code navigation](#15-source-code-navigation)

## 1. Business scope and implementation status

Monk Hagen is a premium streetwear e-commerce website. Visitors discover products; verified customers maintain addresses and a saved cart, pay through Razorpay and view orders and delivery tracking. The designated Google administrator manages the catalog and reviews orders and shipment information.

| Capability | Current implementation |
| --- | --- |
| Storefront | Home, catalog, product details, About, Contact and refund policy |
| Customer identity | MSG91 mobile OTP login and Firebase Google login |
| Administrator identity | Designated verified Google account only; no active admin-password login |
| Product management | Categories, badges, managed sizes/colors, images, variants and inventory |
| Product information | Per-product description plus database-managed shared care, size chart and delivery content |
| Shopping cart | Authenticated PostgreSQL persistence, quantities and variant selection |
| Checkout | Saved-address selection/new-address form and prepaid Razorpay checkout |
| Payments | Server-calculated totals, capture verification, signed webhooks and refund-event ledger |
| Fulfillment | Shiprocket creation queue, tracking and guarded AWB/pickup/label/reconciliation APIs |
| Customer orders | Paid-order list with thumbnails, progress summary, details and tracking dialogs |
| Returns | Seven-day item-level requests, Shiprocket reverse pickup, customer progress, admin receipt/approval and Razorpay refund initiation |
| Credits | Customer balance and transaction-history display; no implemented checkout redemption flow |
| Email | Contact submissions and retried paid-order confirmations, with store-inbox BCC |
| Deployment | Local Node runtime and Vercel entry point/configuration; live readiness requires the checklist below |

### Roles and access

- **Visitor:** public pages and active catalog. Cannot change catalog data or read customer accounts.
- **Customer:** authenticated account, own addresses/cart/orders/returns/credits and permitted shipping lookups.
- **Administrator:** privileged catalog, media, order and fulfillment operations. The configured Google identity is checked on the server.
- **Legacy `super_admin` role:** equivalent privileged permissions under the same Google-only identity policy; not a separate password-based account.

The official customer-contact address is **official@monkhagen.in**. The public phone card is hidden. The contact address and the administrator login allowlist are separate settings.

## 2. High-level design

### 2.1 Architecture

The application is a modular monolith: one Angular storefront/admin application and one Express backend share a PostgreSQL database. External providers handle identity, payment collection, shipping, object storage and email delivery.

```text
                       Customer / Administrator
                                  |
                           Angular application
                         public + protected routes
                            /             \
                 Firebase browser SDK     HTTPS /api + Bearer JWT
                         |                         |
                  Firebase Authentication    Express API
                                              |
                           +------------------+------------------+
                           |                  |                  |
                      Controllers        Business services    Middleware
                           |                  |              auth/validation
                           +-------- PostgreSQL models       rate limits
                                              |              headers/errors
                                     pg connection pool
                                              |
                                      Neon PostgreSQL
                                              |
                             orders, stock, carts, queues,
                              sessions and operation leases

       Express services --> Razorpay / Shiprocket / R2 / Zoho SMTP
       Browser ----------> Razorpay hosted checkout / public media
```

Private provider credentials remain in the backend environment. Firebase web configuration and Razorpay's public checkout key identifier are browser-facing configuration, not private signing credentials.

### 2.2 Runtime choices

| Runtime | Frontend | Backend | Background execution |
| --- | --- | --- | --- |
| Local development | Angular dev server on port 4200 | Express on port 3000; `/api` development proxy | Node shipping, email and security workers |
| Local production-style | Compiled Angular files served by Express | Long-running Node process | Workers outside Vercel |
| Planned Vercel | Static Angular output | `api/index.js` serverless handler | Authenticated maintenance invocations; no detached worker dependency |

The Vercel handler reuses initialized application/pool state within a warm instance. Different instances still coordinate through database-backed limits and leases. Memory caches are not shared across instances.

### 2.3 Technology baseline

- Angular 20 standalone components, Angular Router, template-driven forms, RxJS and TypeScript.
- Node.js **20.19 or newer**, Express 4, `pg` and PostgreSQL.
- Firebase browser SDK and Firebase Admin SDK.
- Application JWTs with `jsonwebtoken`.
- Razorpay SDK and signed webhook processing.
- Shiprocket HTTP integration.
- AWS S3-compatible SDK for Cloudflare R2.
- Nodemailer for SMTP; Multer and `file-type` for upload intake/inspection.
- Helmet, application validation and PostgreSQL-backed rate limiting.
- Karma/Jasmine frontend tests and Node's test runner for backend tests.

Exact installed versions are controlled by [package-lock.json](../package-lock.json); [package.json](../package.json) contains the supported runtime and commands.

### 2.4 Architectural boundaries

1. Angular presents data and requests operations; it is not trusted for roles, prices, stock or payment status.
2. Express verifies identity, authorization and input before business operations.
3. PostgreSQL provides durable state, transactions, uniqueness, inventory protection and cross-instance coordination.
4. Providers remain independent systems: a local transaction cannot roll back an accepted payment, shipment or email.
5. Ambiguous external mutations require reconciliation rather than blind retries.

## 3. Low-level design

### 3.1 Backend layering

| Layer | Responsibility | Examples |
| --- | --- | --- |
| Routes | HTTP methods, middleware and handler binding | `server/routes/payments.js`, `server/routes/account.js` |
| Middleware | Authentication, admin policy, validation, limits and errors | `server/middleware/auth.js`, `validation.js`, `rateLimit.js` |
| Controllers | Read requests, invoke operations, return bounded API responses | `server/controllers/contactController.js` |
| Services | Multi-step domain rules and provider orchestration | `paymentService.js`, `inventoryService.js`, `shippingService.js` |
| Models | Parameterized database access and record formatting | `Product.js`, `Cart.js`, `Order.js`, `Shipment.js` |
| Configuration | Environment loading, pool and provider clients | `server/config/db.js`, `shiprocket.js`, `mailer.js` |
| Migrations | Versioned changes recorded in `schema_migrations` | `server/migrations/` and base/administration migrations in `db.js` |

### 3.2 HTTP request pipeline

The shared Express application is built in [server/app.js](../server/app.js):

```text
Request
  -> security headers + configured CORS
  -> Razorpay webhook raw-body route, when applicable
  -> normal JSON parsing + API request-shape checks
  -> route authentication / permissions / limits / field validation
  -> controller -> business service -> parameterized database/provider access
  -> response or centralized sanitized error
```

The webhook raw-body parser is registered before normal JSON parsing so the signature is checked against the exact received bytes. Ordinary JSON bodies are bounded to 2 MB; webhook bodies to 1 MB. Multipart upload limits are separate.

`/api/health` is an application health endpoint, not proof that every provider, permission or production workflow is operational. Non-API browser paths support the Angular application; unknown API paths do not become successful SPA responses.

### 3.3 Database initialization

[server/config/db.js](../server/config/db.js) creates the `pg.Pool`:

- A non-empty `process.env.DATABASE_URL` takes precedence and supplies the entire connection configuration.
- Without it, existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` configuration remains available.
- Neon URL TLS requirements are not overwritten with an insecure custom SSL object.
- Connection startup executes a harmless `SELECT NOW()`.
- Development startup normally applies pending migrations.
- Production startup does **not** automatically migrate; it checks the runtime role and rejects unsafe privileges.

Migrations use a transaction-scoped advisory lock and a migration-name ledger. Migration ownership and application runtime access are intentionally separate in production. Pointing development at a production database can still apply migrations: select the environment carefully before starting development tools.

### 3.4 Authentication sequence

```text
Google login
  -> browser obtains Firebase ID token
  -> POST /api/auth/firebase
  -> backend verifies ID token, verification state and identity binding
  -> backend determines role; designated Google identity required for admin
  -> backend issues short-lived application JWT

Mobile OTP login
  -> POST /api/auth/otp/send (backend calls MSG91)
  -> customer enters the SMS code
  -> POST /api/auth/otp/verify (backend verifies through MSG91)
  -> backend finds or creates the verified phone customer
  -> backend issues the same application JWT

Both paths
  -> browser attaches JWT only to application API requests
  -> each protected request rechecks database user, role and session version
     plus bounded Firebase account/revocation checks for Firebase sessions
```

Application tokens are HS256-signed with issuer `monkhagen-api` and audience `monkhagen-web`. Customer and administrator lifetimes are capped at one day. `JWT_EXPIRES_IN` may shorten this lifetime but cannot extend it beyond the security ceiling.

The browser stores application token/user state under `mh_token` and `mh_user`. This is bearer-token authentication, not cookie authentication. Logout clears browser state and requests server-side session-version invalidation. A failed logout request cannot guarantee server invalidation, although local state is cleared.

Firebase account checks have short, bounded process-local caches, so provider revocation is not instant across every request. PostgreSQL session-version and active-role checks remain authoritative for application sessions. Browser route guards improve navigation but are not authorization controls.

### 3.5 Checkout and payment sequence

```text
Owned cart + selected owned address + checkout token
  -> serialize checkout for customer in a database transaction
  -> validate products, variants, quantities and current prices
  -> lock relevant cart/inventory records
  -> reserve stock and save pending order/item/address snapshots
  -> create Razorpay order and persist its identifier
  -> browser opens hosted Razorpay checkout
  -> successful callback OR verified capture webhook
  -> verify signature/payment identity/captured amount and currency
  -> finalize once under order lock
  -> convert cart + queue shipment
  -> email worker / maintenance sends paid-order confirmation
```

Important domain rules:

- Cart quantities are integers between 1 and 100; checkout is bounded to 50 lines.
- Product and variant availability is verified on the server.
- Unit prices and totals come from database records, not browser-submitted prices.
- Stock reservations normally expire after fifteen minutes.
- Conditional stock updates and row locks prevent two checkouts from consuming the same last unit.
- A checkout token and unique gateway identifiers reduce duplicate order/payment processing.
- Browser checkout dismiss/failure does not itself establish a paid order.
- Finalization checks captured payment identity, amount and INR currency.
- Duplicate confirmed callbacks/webhooks do not deduct inventory again.
- Late capture after released stock tries to secure inventory; failure records payment and sets a fulfillment-review hold instead of silently shipping unavailable stock.
- Capture after cancellation/return preserves terminal lifecycle state and requires review.

Razorpay order creation involves a remote request during local transactional work. A remote success followed by local failure is still a distributed-system failure case; do not interpret these safeguards as an unconditional exactly-once guarantee.

### 3.6 Webhook and refund processing

The backend verifies Razorpay webhook HMAC signatures using the webhook secret before parsing/trusting payloads. Event identifiers, or a body-derived identifier when needed, are recorded for idempotency.

Capture events finalize validated payments; failure events release eligible pending inventory once. `refund.processed` events maintain a refund ledger keyed by provider refund identity and validate positive amounts, currency, payment/order linkage and cumulative refund bounds.

Refund events can set partial/full financial status and a fulfillment hold. Approved prepaid returns can initiate a bounded Razorpay refund; the signed `refund.processed` webhook is still the source of truth for completion. COD refunds remain manual. Before physical pickup, cancelling a known Shiprocket return is attempted remotely before the local return becomes cancelled; uncertain outcomes stay pending reconciliation. Cancellation is unavailable after pickup, while rejection after warehouse receipt is a local inspection outcome.

### 3.7 Separate state dimensions

| Dimension | Meaning | Example |
| --- | --- | --- |
| Payment status | Financial outcome | Pending, paid, partially refunded, refunded |
| Order status | Commerce lifecycle | Placed, confirmed, processing, shipped, delivered, cancelled, returned |
| Shipping status | Fulfillment/provider progress | Pending, retry pending, created, AWB assigned, pickup scheduled, needs review |
| Fulfillment hold | Exception requiring operator review | Inventory shortfall after capture or refund review |

Do not equate a created Shiprocket shipment with an AWB, scheduled pickup or delivered order.

Order transitions are guarded in [orderStatusPolicy.js](../server/services/orderStatusPolicy.js):

```text
placed -> confirmed / processing / cancelled
confirmed -> processing / shipped / cancelled
processing -> shipped / cancelled
shipped -> delivered
delivered -> return_requested
return_requested -> delivered / returned
cancelled and returned -> terminal
```

Advancement requires payment/inventory eligibility and absence of a fulfillment hold. Shipping requires AWB and scheduled-pickup evidence. Delivery/shipping timestamps preserve the first recorded event. Local status changes do not automatically cause remote refunds or shipment cancellation.

### 3.8 Durable shipping coordination

`Shipment.withLock()` acquires a database operation lease per order, with an owner token, five-minute expiry and heartbeat. Writes are fenced against the current lease owner. This works across separate Node/Vercel instances without relying on session-level locks behind the Neon pooler.

Before a remote create/AWB/pickup/label mutation, the backend records `pending_operation`. Confirmed success saves provider identifiers. Ambiguous timeouts/crashes retain review state; reconciliation checks the remote order identity before adopting its result. Existing shipment mappings are reused instead of creating another shipment.

### 3.9 Email delivery semantics

Paid confirmations are selected from unsent paid orders and protected by a transaction-scoped order lock. Successful SMTP delivery is followed by `confirmation_email_sent_at` persistence. Customer email is the recipient; the configured store inbox is BCC.

Retries cover ordinary delivery failures. SMTP acceptance followed by database failure can still produce a duplicate email on retry; the timestamp is not an external-provider exactly-once receipt.

## 4. Module-wise functionality

### 4.1 Shared navigation and branding

**Frontend:** `src/app/components/header/`, `footer/`; `src/app/config/media-assets.ts`.

- Desktop/mobile navigation, branded logo, account/login/logout and administrator navigation.
- Cart badge reflects authenticated cart quantities.
- Public footer links and refund policy.
- Central media configuration for marketing/banner assets.
- Responsive page styling, consistent blue accents and dialog backdrops.

Marketing asset configuration remains code-managed; it is not an administrator-editable full-site CMS.

### 4.2 Home and discovery

**Frontend:** `src/app/pages/home/`; shared product cards.  
**Backend/data:** products, categories, badges and product images.

- Five configured hero slides, sliding animation and two-second interval.
- Slide indicators support direct navigation; the visible pause button was removed.
- Featured products and New Arrivals sections.
- Product cards display image, category, title, price and badge.
- Hover-only image cycling across available product images, with timer cleanup and reset on mouse leave.
- Quick Add opens variant/size selection and sends an authenticated cart operation.
- Configured Instagram-style media section and marketing content; not a live Instagram API integration.

Home currently requests featured products and a separate general product list, then uses bounded subsets for the visible sections. Returning to the page can request these again; there is no persistent catalog-service cache.

### 4.3 Catalog and search

**Frontend:** `src/app/pages/products/`, `services/product.service.ts`.  
**Backend:** `routes/products.js`, `models/Product.js`.

- Active catalog browsing, category filtering, search and product navigation.
- Hover slideshow and Quick Add through the shared product-card component.
- Public responses exclude inactive catalog data according to backend policy.
- Filter/pagination input is validated and bounded.
- Dynamic SQL identifiers come from controlled application choices; user values are parameterized.

### 4.4 Product details and shared information

**Frontend:** `src/app/pages/product-details/`, `components/product-page-content-editor/`.  
**Backend:** `models/Product.js`, `ProductPageContent.js`; product and product-page-content routes.

- Product gallery, image navigation and thumbnails.
- Managed color/size choices and quantity controls; sizes use consistent ordering.
- Add to Cart validates required selections and displays errors.
- Numerical stock counts are hidden from the customer product-details UI; “Sold out” remains meaningful.
- The former star placeholder is replaced by a blue **Size chart** link.
- Size-chart image opens in a native dialog with blurred backdrop and close control.
- Expandable **Product details** uses each product's description.
- Expandable **CARE / KEEP IT FRESH** uses shared instructions rendered as bullets, with spacing aligned to product details.
- Shared estimated delivery and explanatory note are displayed from database content.
- Public ratings use approved review data only, including a one-decimal average, star distribution, paginated sorting and approved customer photos.
- Guests can read reviews. Review creation, editing and helpful voting require login; review creation additionally requires a delivered order-item owned by that customer.
- One review per customer/product is linked to a deterministic delivered order item. A later return or refund preserves the historical verified-buyer status because delivery remains recorded.
- Review photos use the existing private R2 client with inspected JPG, PNG, WebP or AVIF content, five-photo and 5 MB-per-photo transport limits, and generated `reviews/` object keys.
- Administrators can hide or restore reviews but cannot rewrite customer ratings or comments.

Content ownership is explicit:

| Content | Storage/editing scope |
| --- | --- |
| Product name, price, images and description | Individual product record, edited through catalog administration |
| Size-chart image URL | Shared `product_page_content` record, edited through content editor |
| Care instructions | Same shared record; separate lines become bullets |
| Delivery estimate and note | Same shared record, not a product-specific shipping promise |

Initial shared content includes a 2–4 day estimate and note about some locations taking up to seven days. Initial care covers cold/30°C washing, inside-out washing, similar colours, no bleach, no prolonged soaking and avoiding direct ironing on print. These are initial database values, not immutable frontend constants; administrators can change them.

### 4.5 Customer login

**Frontend:** `pages/login/`, `services/firebase.service.ts`, `auth.service.ts`.  
**Backend:** MSG91 OTP/Firebase authentication controllers, auth middleware and user model.

- Sign in using an Indian mobile number and a six-digit MSG91 code, or continue with Google.
- Customer email/password fields are not shown on the storefront login page.
- OTP secrets stay on the backend; the browser receives only the existing application JWT after provider verification.
- Resend has a 45-second browser countdown plus independent server limits per IP and normalized phone number.
- An unverified profile phone is never silently merged into an existing Google account.

Administrator login is Google-only for `ADMIN_GOOGLE_EMAIL`. Legacy password columns/dependencies are not evidence of an enabled admin-password endpoint.

### 4.6 Profile and address book

**Frontend:** `pages/account/profile/`, `addresses/`.  
**Backend:** account controller and shared address-validation service.

- Customer profile display/update.
- Create, edit, delete and choose a default saved address.
- Server ownership predicates prevent one customer changing another customer's address.
- Required-field validation appears next to individual fields.
- Name, street address, city and state have length bounds.
- Indian mobile number validation: ten digits beginning with 6–9.
- Indian PIN validation: six digits beginning with 1–9.
- Delivery country currently restricted to India.
- Optional address line/landmark and supported address type are validated.
- Saved address count is capped at fifty; default-address uniqueness is protected in PostgreSQL.

The same backend validation is reused during checkout; frontend validation is not the only protection.

### 4.7 Cart and checkout address dialog

**Frontend:** `pages/cart/`, `services/cart.service.ts`, `payment.service.ts`.  
**Backend:** cart model/controller, payment and inventory services.

- Cart belongs to the authenticated customer and persists in PostgreSQL.
- Add selected variants, update quantities, remove items or clear the active cart.
- Order summary displays current cart prices and totals.
- Checkout dialog offers saved addresses and a new-address form.
- A customer can cancel adding an address and return to existing-address selection.
- Wider responsive popup, professional copy, fixed header/footer and internal scroll area.
- Validation messages remain inside the popup next to mandatory fields instead of appearing behind it.
- Razorpay checkout opens only after server order creation succeeds.
- Cart conversion/clearing follows confirmed server payment, not just a browser success display.

The current browser checkout is prepaid Razorpay. A guarded COD order path exists in backend logic, but this is not a complete visible COD checkout experience.

### 4.8 Customer orders and tracking

**Frontend:** `pages/account/orders/`.  
**Backend:** account orders/tracking handlers, order and shipment models/services.

- My Orders uses the paid-only account-orders endpoint, with a corresponding client filter.
- Cards show order number/date, total, product thumbnails and progress summary.
- Details open in a popup rather than a long expanded inline block.
- Details include items, size/color, quantities, prices, totals, payment and saved shipping address.
- Each order has a tracking action opening a separate detailed dialog.
- Tracking presents available courier/AWB/status/events and appropriate pending information.
- Requests are customer-owned; identifiers alone do not grant access.
- Tracking is user-triggered, not continuous per-second polling.

Confirmed Razorpay orders remain visible after partial or full refunds, and COD orders remain visible through their supported financial states. Thumbnails come from current product images, while financial/item/address snapshots are saved at order creation.

### 4.9 Returns and store credits

**Frontend:** `pages/account/returns/`, `credits/`; account service.  
**Backend:** account handlers and `services/returnService.js`.

Return submission API rules:

- Order must belong to the caller and be delivered.
- Request must be within the current seven-day window.
- Multiple partial requests are allowed, but active returned quantities cannot cumulatively exceed purchased quantities.
- Items must belong to that order; quantities cannot exceed the remaining returnable quantities.
- Duplicate submitted item IDs, excessive items and invalid reason/comment lengths are rejected.
- The request and selected item-level refund allocation are saved atomically under an idempotency key.

The order-details dialog provides the customer request form. The backend creates a Shiprocket return order from the immutable customer address to the exact saved location named by `SHIPROCKET_PICKUP_LOCATION`, but does not assign a courier or schedule pickup. A Monk Hagen administrator schedules it from Shiprocket's New returns tab; signed tracking callbacks then advance pickup/transit/receipt state. The administrator returns tab can retry definitive return-creation failures, reject local requests, cancel known pre-pickup Shiprocket returns, record post-receipt inspection rejection, restore stock once after receipt, and initiate prepaid refunds. COD payout completion and uncertain provider reconciliation remain operator procedures.

Credits show the customer's balance and bounded transaction history. No browser-accessible arbitrary balance setter or implemented coupon/credit checkout-redemption engine exists.

### 4.10 Administrator catalog management

**Frontend:** `pages/admin/`.  
**Backend:** protected product/category/badge/size/color routes and models.

- Manage products, descriptions, prices, status, images and size/color variants.
- Manage categories, badges and available size/color options.
- Manage variant inventory without exposing stock counts in the customer details UI.
- Upload image assets to R2 and use existing permitted media URLs.
- Product-save logic supports existing variants/order references rather than indiscriminately replacing referenced records.
- Edit shared product-page content through the content editor.
- Customer visibility is controlled by active catalog policy on the server.

Deleting referenced records can legitimately return a conflict. R2 cleanup must not remove media when the corresponding database deletion fails.

### 4.11 Administrator orders and shipments

**Frontend:** administrator order list and order/shipment detail dialog.  
**Backend:** order administration and shipping APIs.

- Review orders, payment information, totals and shipment state.
- Structured popup displays shipment identifiers, AWB, courier, pickup and errors/progress.
- Refresh orders and retry eligible shipment creation.
- Backend exposes guarded status update, serviceability, AWB assignment, pickup, label generation and reconciliation operations.

Courier selection and forward-shipment actions remain deliberate operator controls. The returns tab covers guarded pre-pickup cancellation, receipt, inspection rejection, approval and prepaid refund initiation, but COD payout completion and uncertain provider reconciliation remain manual procedures.

### 4.12 Contact, policies and notifications

**Frontend:** Contact, contact-email, About and refund-policy pages.  
**Backend:** contact handler, mailer, confirmation service and email worker.

- Contact page shows `official@monkhagen.in`; phone information is hidden.
- Contact email action opens the site's query form.
- Submitted name/email/query are validated; query length is 10–5,000 characters.
- Email goes to configured `CONTACT_EMAIL`, with validated customer address as Reply-To, not forged sender identity.
- Paid confirmations go to customer plus store BCC and are retried if unsent.
- SMTP settings and authentication are backend-only.
- Public policy/marketing copy is code-managed, except the explicitly editable product-page information.

## 5. Database design

### 5.1 Logical entities

| Entity/table | Purpose and important relationships |
| --- | --- |
| `roles`, `users` | Role assignment, Firebase identity binding, active status and session version |
| `customer_addresses` | User-owned saved addresses and unique default address |
| `categories`, `badges`, `sizes`, `colors` | Managed catalog classification/options |
| `products` | Category, base price, description, badge and active state |
| `product_size_details`, `product_color_details` | Product-to-managed-option associations |
| `product_images` | Product image ordering and primary-image designation |
| `product_reviews` | One delivered-purchase review per customer/product, with immutable purchase linkage and moderation state |
| `product_review_images` | Generated R2 keys and public URLs for up to five review photos |
| `product_review_helpful` | Unique customer/review helpful votes |
| `product_variants` | Product/size/color/SKU combination, price, stock and availability |
| `product_page_content` | Singleton shared size chart, care and delivery text |
| `carts`, `cart_items` | User-owned active/converted/abandoned cart and variant quantities |
| `orders` | Financial totals, lifecycle, gateway IDs, checkout identity, inventory timestamps and holds |
| `order_items` | Purchased item/name/options/quantity/price snapshots with source references |
| `order_addresses` | Saved checkout shipping-address snapshot |
| `shipments` | One local shipment record per order, remote mapping, operation intent and tracking cache |
| `payment_webhook_events` | Processed-event identity ledger |
| `payment_refunds` | Provider refund identity and cumulative financial reconciliation |
| `return_requests`, `return_items` | Owned return request and selected purchased items |
| `credit_accounts`, `credit_transactions` | User balance and credit/debit history |
| `security_rate_limits` | Shared atomic rate-limit buckets |
| `operation_leases` | Expiring, owner-token-fenced shared operation locks |
| `schema_migrations` | Applied migration names/timestamps |

```text
User -> Addresses
User -> Cart -> Cart items -> Product variant -> Product
User -> Orders -> Order items + Address snapshot + Shipment
Order -> Return requests -> Return items -> Order items
Order -> Payment refunds
User -> Credit account + Credit transactions
Product -> Category / Badge / Images / Size and Color associations
```

### 5.2 Integrity controls

- UUID primary/referenced identities and validated API identifiers.
- Non-negative price/stock/balance checks and positive item quantities.
- Unique normalized user identity where applicable.
- One active cart and one default address per customer.
- Unique order checkout token and Razorpay order/payment identifiers.
- One shipment per order and consistent remote order/shipment pairing.
- Unique refund/event identities and transactional duplicate handling.
- Foreign keys protect referenced commerce data.
- Row locks, conditional stock writes and inventory timestamps protect stock accounting.

Current schema setup lives in [db.js](../server/config/db.js) and [migrations](../server/migrations/001_shipments.sql). Base schema and Google-only administration migration are implemented in `db.js`, not as separate `000`/`005` SQL files.

### 5.3 Migration sequence

| Recorded migration | Purpose |
| --- | --- |
| `000_base_schema` | Core identity, catalog, cart, order, return and credit schema |
| `001_shipments` | Durable shipment state and provider mapping |
| `002_firebase_auth` | Firebase identity/provider support |
| `003_product_page_content` | Shared delivery-content storage |
| `004_size_chart_care_content` | Shared size chart and care information; preserve existing edits |
| `005_google_only_admin` | Remove legacy privileged passwords and disable non-designated privileged identities |
| `006_security_integrity` | Financial/inventory integrity, refund ledger, limits and shared leases |
| `007_session_revocation` | Database-backed application session version |
| `008_analytics` | Privacy-bounded analytics events and reporting indexes |
| `009_returns_workflow` | Item-level idempotent returns, reverse-shipment state, refund lifecycle and webhook deduplication |
| `010_return_item_comments` | Repairs the optional return-item comments column for databases that applied an earlier revision of migration 009 |
| `011_product_reviews` | Verified-purchase ratings, review photos, moderation and unique helpful votes |

Runtime production account must not own application objects or have migration/administrative capabilities. Applying schema changes is a separate trusted operation, not a normal web request.

## 6. API reference

All paths below are relative to `/api`. This is a route index, not a complete OpenAPI payload specification; request/response details are defined in frontend models, controllers and validation middleware.

| Group | Principal routes | Access/rules |
| --- | --- | --- |
| Health | `GET /health` | Public; basic application status |
| Catalog | `/products`, `/categories`, `/badges`, `/sizes`, `/colors` | Active public reads; protected administrator mutations |
| Product reviews | `GET /products/:productId/reviews[/summary]`, authenticated eligibility/create/edit/helpful routes | Approved reads are public; writes require an owned delivered purchase |
| Admin reviews | `GET /admin/reviews`, `PATCH /admin/reviews/:reviewId/moderation` | Administrator view/filter and hide/restore only |
| Shared content | `GET /product-page-content`, `PUT /product-page-content` | Public read; admin write |
| Identity | `POST /auth/firebase`, alias `POST /auth/google` | Validated Firebase exchange; authentication rate limit |
| Session | `GET /auth/me`, `POST /auth/logout` | Authenticated; logout invalidates application sessions |
| Profile | `GET/PUT /account/profile` | Current authenticated account |
| Addresses | `GET/POST /account/addresses`, `GET /account/addresses/default`, `PUT/DELETE /account/addresses/:id`, `PATCH /account/addresses/:id/default` | Owned address operations |
| Cart | `GET/DELETE /cart`, `POST /cart/items`, `PUT/DELETE /cart/items/:itemId` | Owned cart and variant/quantity validation |
| Payment creation | `POST /payments/create-order` | Owned cart/address, authoritative totals and stock |
| Payment verification | `POST /payments/verify` | Owned order, signature plus gateway capture verification |
| Payment webhook | `POST /webhooks/razorpay` | Raw-body signature; not customer JWT authentication |
| Customer account orders | `GET /account/orders`, `GET /account/orders/:orderId`, `GET /account/orders/:orderId/tracking` | Owned confirmed-payment/COD history |
| Other order APIs | `POST /orders`, `GET /orders/mine` | Authenticated legacy/direct order path and own broader history |
| Admin orders | `GET /orders`, `PUT /orders/:id/status` | Server-admin role and lifecycle/payment/shipment policy |
| Returns | `GET/POST /account/returns`, `GET /account/orders/:orderId/return-eligibility`, `GET /account/returns/:returnId` | Owned item-level history and seven-day delivery eligibility |
| Admin returns | `GET /admin/returns`, `POST /admin/returns/:returnId/{approve,reject,refund,retry-creation}` | Administrator reverse logistics and guarded lifecycle actions |
| Shiprocket tracking webhook | `POST /webhooks/tracking-updates` | Private `x-api-key`; idempotent normalized return updates |
| Credits | `GET /account/credits`, `GET /account/credits/transactions` | Owned read-only API surface |
| Shipping discovery | `POST /shipping/serviceability` | Authenticated, validated parcel/location and limits |
| Shipping tracking | `GET /shipping/:orderId/tracking` | Owned customer order or authorized administrator |
| Shipment creation | `POST /shipping/create-shipment` | Administrator; eligible order; durable lease |
| Fulfillment actions | `POST /shipping/:orderId/assign-awb`, `/generate-pickup`, `/generate-label`, `/reconcile` | Administrator; operation prerequisites and provider verification |
| Upload | `POST /upload` | Administrator; bounded multipart intake and file inspection |
| Media | `GET /media?url=...` | Restricted configured-media proxy, not arbitrary URL fetching |
| Contact | `POST /contact` | Public validated contact form; abuse limit |
| Maintenance | `GET /maintenance` | Exact `Authorization: Bearer <CRON_SECRET>`; configured secret required |

Protected customer records are selected with owner predicates, not solely UUID lookup. Browser-supplied roles and payment status are not authority. Error bodies are sanitized; protected responses use `Cache-Control: no-store`.

## 7. External integrations

### 7.1 Firebase

Browser Firebase SDK handles Google popup login. Backend Firebase Admin verifies tokens and account state. Production must authorize deployed domains in Firebase and keep the Google provider enabled.

The designated administrator must authenticate through Google even if the same email address can be registered with a password. The backend does not grant administrator access just because a browser supplied an email or role.

### 7.2 Neon PostgreSQL

Neon's pooled URL is supplied privately as `DATABASE_URL`; no connection string belongs in committed code. Localhost can connect to Neon with that environment variable, subject to network access and database permissions.

Separate accounts are required for restricted application runtime versus schema ownership/migrations. Production's permission guard intentionally rejects an owner/elevated account even if a simple database connection test succeeds. Connectivity and safe application permissions are different checks.

### 7.3 Razorpay

- Backend creates payment orders and validates authoritative captured payments.
- Browser loads hosted checkout only when checkout is requested.
- Payment callback signature and webhook signature use separate configured secrets.
- Webhooks must target the deployed HTTPS endpoint and use the correct environment's signing secret.
- Test-mode success is not live-mode settlement verification.
- Gateway refund notifications are reconciled; automatic refund initiation is not implemented.

### 7.4 Shiprocket

- Credentials are server-only and exchanged for a token by the backend.
- API base is restricted to the intended HTTPS Shiprocket host.
- Process-local token caching avoids repeated login; concurrent authentication is coalesced.
- Authentication failure can trigger bounded re-authentication, but ambiguous shipping mutations are not blindly replayed.
- Pickup location and parcel weight/dimensions must reflect the configured fulfillment setup.
- Local workers process eligible shipment-creation queue entries; AWB, pickup and labels have separate operations.
- Tracking responses are normalized and briefly cached; internal provider/operation details are not returned to customers unnecessarily.
- Invalid configuration/permissions and uncertain mutations require operator review.

See [Shiprocket setup and operations](shiprocket.md) for the existing integration-specific guide.

### 7.5 Cloudflare R2

R2 uses the S3-compatible backend SDK. Access keys are never provided to the frontend. Public media URLs are used for display, with eligible configured-origin images routed through the bounded media proxy.

Uploads use application-generated keys rather than unsafe client filenames. Immutable cache metadata applies to newly uploaded versioned objects; replacing content at an existing URL can cause stale-cache behavior. Use new URLs for changed assets.

Image input limits: up to eight images per request, ten MB each, accepted image formats JPEG/PNG/WebP/AVIF. The separate video path allows one MP4 with a larger local parser limit. Limits in code are not proof a deployment platform accepts equally large bodies.

### 7.6 Zoho SMTP

Nodemailer sends through privately configured SMTP credentials. TLS certificate verification is enabled; implicit TLS or required STARTTLS depends on configured port/secure settings. Credentials must match the actual mailbox's provider/region setup.

`SMTP_FROM` controls sender identity and `CONTACT_EMAIL` controls store recipient/BCC. Firebase verification/recovery emails are part of Firebase authentication, not the order-confirmation SMTP queue.

## 8. Security design and hardening

The application underwent critical/high/medium/low hardening. This section describes implemented controls, not a guarantee that future changes or production configuration are risk-free. See [production-security.md](production-security.md) for the focused operational checklist.

### 8.1 Critical controls

- Privileged access uses the designated verified Google identity, checked server-side.
- Admin/superadmin password login was removed from the active authentication path.
- Other legacy privileged identities are disabled by the administration migration.
- A configured JWT secret of at least 32 characters is required; no production fallback secret.

### 8.2 High-risk controls

- Server-side prices, bounded quantities, transactionally protected inventory and order snapshots.
- Owned account/cart/address/order/return access and server-admin checks.
- Capture and webhook signature validation plus idempotency/financial identity checks.
- Refund ledger and fulfillment holds for exceptional payment/order situations.
- Guarded order transitions and shipping eligibility.
- Durable cross-instance fulfillment leases and ambiguous-mutation reconciliation.
- Shared PostgreSQL rate limits; failures fail closed rather than silently disabling limits.
- Production runtime database privilege checks and separate migration ownership.

### 8.3 Medium-risk controls

- UUID, shape, query, field-length, numeric, boolean and pagination validation.
- Pagination/search bounds; rejection of malformed repeated/nested query inputs.
- Short-lived JWTs, database session revocation and bounded Firebase revocation/account checks.
- Strict intended-origin production CORS; localhost defaults confined to development.
- Helmet and CSP compatible with Firebase, Razorpay and media; HSTS in production.
- No script `unsafe-eval`/`unsafe-inline` policy dependency; Angular production build adjusted for CSP compatibility.
- Sanitized errors instead of SQL/provider payloads, secrets or stack traces.
- Upload authentication before multipart parsing, file magic/MIME checks and temporary-file cleanup.
- Restricted media proxy origin, redirects, response types, byte size and timeouts.
- Serverless raw webhook parsing safeguards and authenticated maintenance execution.

### 8.4 Low-risk controls

- Public active-catalog filtering and safer exposure boundaries.
- Environment-file protection and repository secret-handling rules.
- SMTP TLS verification and consistent public contact details.
- Aligned dependency/security updates without automatic `npm audit fix --force`.

### 8.5 Authentication/CSRF/XSS notes

Bearer JWTs are explicitly attached to API requests; there is no application authentication-cookie session requiring generic cookie-CSRF middleware. CORS does not replace authentication. Tokens in localStorage remain accessible to executing same-origin JavaScript, so XSS prevention, CSP and short lifetimes remain important.

Product descriptions/care are rendered as text rather than arbitrary trusted HTML. Future rich-text features must not add unrestricted `innerHTML` or bypass sanitization. Current image policy permits HTTPS media broadly for administrator-entered assets; it is not a complete host-specific media allowlist at every UI location.

### 8.6 Rate-limit policy

| Operation | Baseline allowance |
| --- | --- |
| Authentication | 10 requests / 15 minutes, IP-scoped |
| OTP SMS send | 5 / 15 minutes per IP; 1 / 45 seconds, 3 / 15 minutes and 10 / day per phone |
| OTP verification | 20 / 15 minutes per IP and 5 / 15 minutes per phone |
| Contact | 5 / 15 minutes, IP-scoped |
| Administrator access | 120 / minute, verified user-scoped |
| Checkout/payment creation | 5 / 15 minutes |
| Payment verification | 30 / 5 minutes |
| Return submission | 10 / 15 minutes |
| Shipping | 30 / minute |
| Uploads | 5 / 15 minutes |
| Account mutations | 60 / 15 minutes |

Route-specific limit combinations can apply together. Deployment proxy/IP settings must be validated so legitimate users are neither grouped under one incorrect IP nor allowed to spoof client identity.

## 9. Performance and caching

### 9.1 Implemented improvements

- Stable product identities/DOM tracking reduce unnecessary card recreation.
- Product-card image URLs are computed/cached rather than repeatedly transformed during rendering.
- Hover cycling only runs while the pointer is on the card; it advances through available loaded images and cleans up timers.
- Quick Add reuses fetched product detail within that card instance.
- Razorpay script loading is deferred until payment checkout and coalesced within the page lifetime.
- Configured-origin media proxy supports ETag/Last-Modified conditional requests and browser cache headers.
- Proxy cache allows approximately one-hour freshness and longer stale-while-revalidate behavior; a network entry can still represent a cached or conditional response.
- New versioned R2 uploads have long immutable cache metadata.
- Shiprocket token and tracking caches reduce repeated external requests.

### 9.2 What is not cached forever

- Home/catalog service data is not persisted across all route/component recreation.
- A `media?url=...` request is a controlled media fetch path, not automatically a new image upload or database mutation.
- Scrolling can reveal lazy-loaded images; browser eviction, reloads and disabled-cache DevTools settings affect observed requests.
- Hover image loading/decode can still be slow for large assets or slow connections.
- Authenticated account/order/payment data deliberately uses no-store caching.
- Process-local provider caches disappear on restart/cold start and are not shared by all Vercel instances.

Use optimized WebP/AVIF assets at suitable dimensions and new versioned URLs. There is no general server-side resizing/transcoding pipeline in the current implementation. Marketing video download/decode can outweigh savings from image caching.

## 10. Configuration, development and operations

### 10.1 Environment-variable inventory

Set local secrets privately in the root `.env`, which is ignored by Git. Do not paste them into chat, commit them, add them to examples or expose them in logs. Production uses deployment environment settings, not an uploaded `.env` file.

| Area | Variables | Notes |
| --- | --- | --- |
| Runtime | `NODE_ENV`, `PORT` | Production enables stricter guards; local port defaults to 3000 |
| Database | `DATABASE_URL` | Preferred Neon pooled connection; preserve TLS/channel-binding settings supplied by Neon |
| Local DB fallback | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Used only when URL is absent |
| API identity | `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_GOOGLE_EMAIL` | Strong secret, bounded lifetime, explicit Google administrator |
| Firebase server | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Admin SDK private configuration, never frontend configuration |
| Customer mobile OTP | `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | Backend-only MSG91 OTP API credentials and approved template |
| Browser policy | `CORS_ORIGINS`, `TRUST_PROXY` | Exact HTTPS production origins; trusted proxy networks only |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Match test/live environment and webhook configuration |
| Shiprocket login | `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_BASE_URL`, `SHIPROCKET_TIMEOUT_MS` | Server-only; restricted HTTPS API base |
| Shiprocket parcel | `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_PACKAGE_WEIGHT_KG`, `SHIPROCKET_PACKAGE_LENGTH_CM`, `SHIPROCKET_PACKAGE_BREADTH_CM`, `SHIPROCKET_PACKAGE_HEIGHT_CM` | Real pickup name and package defaults in kg/cm |
| Shiprocket returns | `SHIPROCKET_WEBHOOK_SECRET`; reuses `SHIPROCKET_PICKUP_LOCATION` | Reverse-tracking authentication; the exact saved Shiprocket pickup location supplies the return destination/contact |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Private storage access plus public asset base |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `CONTACT_EMAIL` | Official inbox for submissions/order BCC |
| Maintenance | `CRON_SECRET` | Strong secret of at least 32 characters; exact bearer authorization |
| Vercel parsing | `NODEJS_HELPERS` | Set to `0`; application fails closed if required raw-body safeguard is absent on Vercel |

Frontend Firebase web configuration is currently managed in [environment.ts](../src/environments/environment.ts). Backend environment changes do not automatically rewrite this browser build configuration. Private Firebase credentials must never be added there.

### 10.2 Commands

Run from the repository root:

```bash
npm install
npm run dev
```

Useful separate commands:

```bash
npm start                 # Angular development server
npm run server:dev        # Backend with nodemon
npm run server            # Backend without nodemon
npm run build             # Angular production build
npm run start:prod        # Build, then long-running Express runtime
npm run db:check          # Read-only connectivity/readiness check
npm test                  # Angular tests
npm run test:shipping     # All server/tests/*.test.js suites
npm audit                 # Installed dependency vulnerability review
```

Changing `.env` requires restarting the backend; ordinary source reload does not guarantee changed environment values are loaded.

`npm run db:check` reports connection success, expected database-name match and session-revocation schema availability without printing database credentials or customer records. It does not certify safe production-role privileges or external integrations.

### 10.3 Migration and maintenance commands

```bash
npm run db:migrate
npm run security:maintenance
```

Migration command is for an authorized schema-management environment. It changes schema and must not be treated as a harmless connectivity test. Review/backup first and use the separate owner account where appropriate.

Maintenance performs controlled housekeeping, including expired reservations and security-state cleanup. Local Node workers handle eligible shipping and email retries. On Vercel, schedule authenticated `/api/maintenance` invocations; the current `vercel.json` does not define a cron schedule. The HTTP job bounds shipping/email work per invocation to avoid a detached long-running worker assumption.

**Never run `npm run seed` on Neon production.** The development seed deletes application data and contains predictable legacy development setup. It is not required to connect to an already migrated database.

### 10.4 Troubleshooting guide

| Symptom | Safe checks |
| --- | --- |
| Latest changes not visible | Confirm running directory/branch, restart correct dev process, inspect build and browser cache |
| Database connection failure | Privately verify URL/env loading, TLS/network access and `db:check`; do not log the URL |
| Production rejects database role | Use a restricted runtime role; connection success with owner credentials is insufficient |
| Google login fails | Firebase domain/provider configuration, server verification, identity binding and backend availability |
| Paid order absent in shipments | Check payment finalization, fulfillment hold, shipment row/status, provider permissions and configured parcel |
| Shiprocket authentication fails | Restart after env edits; log status/error codes only, not credentials/token/provider response body |
| Shipment needs review | Reconcile remote state before retrying a mutation |
| No order email | Verify SMTP privately, recipient/BCC setup, unsent marker, worker/maintenance execution and mailbox spam filtering |
| Repeated media URLs | Inspect cache source/status/initiator and lazy loading before concluding every request is a full download |
| Large upload fails on Vercel | Verify actual platform request limits; parser limits do not bypass hosting limits |

## 11. Testing and acceptance

### 11.1 Existing automated coverage

Tests cover authentication policy, ownership, address/input validation, shared product content, stock/checkout/payment integrity, webhooks/refunds, shipping mapping/retries/leases, upload/media protections, security headers/production role checks and account/session behavior. Frontend suites exercise component/service behavior and key UI flows.

The most recent recorded pre-documentation verification included:

- Backend: **123 passing**, one optional PostgreSQL shipping integration test skipped.
- Frontend: **37 passing** in the full run, plus one newly added Contact test verified separately.
- Angular production build successful, with existing non-fatal CSS budget/unused-import warnings.
- `npm audit`: zero reported vulnerabilities at that time.
- Read-only Neon connectivity check successful with expected database/schema readiness.

These are dated development checks, not new tests executed by this documentation change, provider certification or proof that production environment values are complete. Optional database tests and live-provider scenarios need deliberate execution in the right environment.

### 11.2 End-to-end acceptance scenarios

1. Visitor can browse active products; inactive products do not leak through public APIs.
2. MSG91 mobile OTP and Firebase Google customer login work.
3. OTP paste, resend cooldown and change-number controls work.
4. Non-designated identities cannot access administrator endpoints.
5. Customer cannot read/edit another customer's addresses/cart/orders/returns/credits.
6. Invalid address fields show errors inside address-book/checkout forms.
7. Product size-chart dialog, care accordion, gallery and hover slideshow behave on desktop/mobile.
8. Checkout uses server prices; altered browser totals/quantities are rejected or ignored appropriately.
9. Successful payment creates one paid order and one eligible shipment queue record.
10. Duplicate callback/webhook does not duplicate stock deduction or local fulfillment records.
11. Failed/expired payment releases reservation; late capture with insufficient stock produces review hold.
12. Shipment creation, AWB, pickup, label and tracking are separately verified.
13. Ambiguous shipping mutation is reconciled without creating duplicate provider records.
14. Customer receives confirmation and official inbox receives BCC; contact submissions deliver.
15. Refund events reconcile financial state without incorrectly restarting fulfillment.
16. Eligible return API accepts owned delivered items; ineligible/duplicate requests fail.
17. Production domain CSP/CORS works with Firebase popup and Razorpay checkout.
18. Scheduled maintenance is authorized, monitored and actually executes on deployment.

Mock-provider tests do not contact providers or establish live payment settlement. Do not test destructive inventory/refund/seed operations casually against production data.

## 12. Production deployment checklist

The code contains deployment support, but production readiness is conditional on completing and verifying external configuration. Earlier readiness checks identified restricted database role and operational environment setup as outstanding; this documentation does not claim those have subsequently been completed.

### 12.1 Database

- Create/use a least-privileged runtime role; SQL-created roles must not inherit provider administrator capabilities.
- Grant only required connection/schema use and application-table/sequence permissions.
- Do not give runtime account object ownership, schema creation or migration-ledger write access.
- Use a separately controlled owner/migration identity for schema changes.
- Ensure grants cover existing objects and future objects created by the actual migration owner.
- Privately set the pooled runtime `DATABASE_URL` in deployment settings.
- Run read-only connectivity checks and verify production startup accepts the role.
- Establish backup/recovery and a non-production test database/branch.

### 12.2 Vercel and domains

- Configure `NODE_ENV=production`, `NODEJS_HELPERS=0`, strong `JWT_SECRET` and strong `CRON_SECRET`.
- Set all required provider environments privately; keep preview/test isolated from live resources.
- Set exact intended HTTPS `CORS_ORIGINS`; confirm any `TRUST_PROXY` setting matches real trusted infrastructure.
- Build Angular and ensure `/api` rewrites reach the Express handler while browser routes reach the SPA.
- Authorize deployed Firebase domains and confirm CSP-compatible popup behavior.
- Schedule and monitor authenticated maintenance; no current cron schedule is declared in the repository.
- Verify actual function duration, request-body/upload limits, ephemeral disk and streaming behavior for the chosen deployment.
- Confirm HTTPS/security headers and generic client errors on the deployed domain.

### 12.3 Providers and business operations

- Configure correct test/live Razorpay keys and deployed webhook URL/secret/events.
- Verify capture, duplicate webhook, failure and refund reconciliation scenarios.
- Confirm Shiprocket account permissions for create/update, pickup location, package defaults and courier actions.
- Confirm R2 public media delivery and least-privileged server storage credentials.
- Configure Zoho SMTP credentials/sender privately and confirm customer + store BCC/contact delivery.
- Review all marketing/shipping/returns policy copy against actual operational promises.
- Define who handles fulfillment holds, returns, refunds and provider reconciliation.
- Do a controlled deployed-domain smoke test before accepting real customer payments.

See [production-security.md](production-security.md) for the security-focused runbook. Platform/provider configuration must be checked against current official documentation when deploying; repository settings cannot guarantee external service limits or account permissions.

## 13. Development history

This is a high-level summary of work represented by the repository and recent Git history, not a verbatim record of every conversation or commit.

| Phase | Work delivered |
| --- | --- |
| Initial application | Angular/Express/PostgreSQL foundation, development/build setup and environment separation |
| Storefront | Home sections, branding, footer, public media configuration, product catalog/details, About and policy pages |
| Customer account | Google/Firebase identity, profile, addresses, order history, returns/credit displays |
| Catalog administration | Products, category/badge/size/color management, variant stock and media uploads |
| Media and email | R2 integration, controlled media path/cache, contact form and paid-order customer/store notifications |
| Persistent shopping | PostgreSQL per-customer carts rather than shared browser-only cart state |
| Payments | Razorpay hosted checkout, server verification, signed webhooks and duplicate handling |
| Shipping | Shiprocket login/create mapping, durable retry state, tracking and administrator shipment details |
| Checkout/order UX | Wider professional address dialog, internal scrolling, field errors, saved-address fallback, paid-only customer list, details/tracking popups and thumbnails |
| Performance | Deferred Razorpay script, stable card/image handling, cached media responses and hover image cycling |
| Customer mobile login | MSG91 OTP send/verify, abuse limits and verified-phone customer mapping |
| Neon migration support | `DATABASE_URL`-first pool, local fallback, safe connection diagnostics |
| Login UX | Indian mobile input, masked verification screen, six OTP positions, paste, resend countdown and Google alternative |
| Product content | Editable shared delivery/care/size chart, per-product details, size popup and aligned accordions; customer stock-count removal |
| Visual refinements | Five-slide two-second hero, removed pause control, About styling and product hover slideshows |
| Critical security | Designated Google-only administrator; legacy privileged passwords disabled |
| High security | Checkout/stock/refund/return/fulfillment integrity, ownership and database privilege protections |
| Medium security | Validation, session revocation, headers/CSP/CORS, uploads/media, distributed limits and serverless safeguards |
| Low security/contact | Catalog exposure/environment protection/SMTP TLS; official inbox and hidden phone |

### Recent traceable commits

| Commit | Date | Summary |
| --- | --- | --- |
| `19d81ee` | 17 Sep 2026 | Medium security findings and official contact details |
| `dcd88f2` | 17 Sep 2026 | High findings: checkout integrity, returns and shipping guards |
| `dfabc27` | 17 Sep 2026 | Low findings: catalog privacy, environment protection and SMTP TLS |
| `c8dfaeb` | 17 Sep 2026 | Critical finding: Google-only admin authentication |
| `fbc88a0` | 17 Sep 2026 | Address validation and required JWT secret |
| `eda4d3a` | 17 Sep 2026 | Editable product content and size-chart popup |
| `74872e3` | 17 Sep 2026 | Banner/hover slideshows and product variant-save fixes |
| `b7c48d5` | 16 Sep 2026 | Neon support and storefront authentication UX |
| `9d5263e` | 15 Sep 2026 | Universal customer email authentication |
| `60cac68` | 15 Sep 2026 | Lazy-loaded Razorpay checkout |
| `d9d0dab` | 15 Sep 2026 | Order tracking and checkout experience |
| `c1cf025` | 15 Sep 2026 | Checkout address validation and size ordering |
| `edc4cc4` | 15 Sep 2026 | Backend integrations and shipment retries |

For full provenance, inspect `git log`; commit presence does not certify deployment or external provider testing.

## 14. Known limitations and future work

1. **Production configuration still needs independent verification.** Runtime database privileges, SMTP, domain/provider settings and scheduled maintenance are outside a successful local build.
2. **Returns still require operator handling for exceptions.** COD payout completion, reverse-pickup cancellation and uncertain Shiprocket outcomes must be reconciled manually before retrying external mutations.
3. **Reverse logistics needs live acceptance testing.** Confirm account-specific return permissions, webhook delivery, warehouse details and real pickup behavior in a controlled provider environment.
4. **Progress display is simplified.** Current status-text heuristics should not be treated as the canonical provider state machine; distinguish “out for delivery” from actually delivered.
5. **Catalog requests are not persistently cached.** Consider bounded service caching/invalidation after measuring route repeat loads; do not cache inventory/payment decisions as authority.
6. **Media optimization is manual.** Add responsive image sizes/transcoding or an image delivery service if bandwidth/decode remains a problem.
7. **Large uploads need a deployment-compatible design.** Verify hosting limits and consider constrained direct-to-storage uploads for large video; current backend parser limits alone are insufficient.
8. **Admin fulfillment controls are not all complete UI workflows.** Backend operations need deliberate operator tooling/acceptance testing.
9. **COD, coupons and credit redemption are not full storefront features.** Avoid advertising unimplemented checkout choices or balance/promotion mechanisms.
10. **Full-site copy/media is not all CMS-managed.** Product shared content is editable; many home/About/policy elements remain code-managed.
11. **External effects are not globally exactly-once.** Preserve reconciliation and review procedures for remote success/local failure, including email duplicates.
12. **Bearer-token storage remains an XSS consideration.** Continue dependency review, safe rendering, restrictive CSP and short sessions.
13. **Uploads are not malware scanning/transcoding.** File signature checks do not replace antivirus, complete container validation or image re-encoding.
14. **Operational monitoring is required.** Add actionable alerts for stuck fulfillment, failed mail, maintenance failures, provider incidents and unsafe configuration.
15. **Existing build warnings remain.** CSS budgets/unused imports do not block the recorded build but should be reviewed in future cleanup.
16. **README contains historical statements.** Prefer this baseline document and security runbook for current Google-only administration, production migration separation and bounded JWT lifetime. Update older quick-start details deliberately when maintaining the README.

## 15. Source-code navigation

| Subject | Primary sources |
| --- | --- |
| Frontend routes | [app.routes.ts](../src/app/app.routes.ts) |
| API construction | [app.js](../server/app.js), [index.js](../server/index.js) |
| Vercel | [api/index.js](../api/index.js), [vercel.json](../vercel.json) |
| Database connection/schema | [db.js](../server/config/db.js), [databasePermissions.js](../server/config/databasePermissions.js) |
| Read-only DB diagnostics | [checkConnection.js](../server/checkConnection.js) |
| Authentication/policy | [auth middleware](../server/middleware/auth.js), [security.js](../server/config/security.js), [firebaseSession.js](../server/services/firebaseSession.js) |
| Frontend identity | [auth.service.ts](../src/app/services/auth.service.ts), [firebase.service.ts](../src/app/services/firebase.service.ts) |
| Validation/limits | [validation.js](../server/middleware/validation.js), [rateLimit.js](../server/middleware/rateLimit.js), [addressValidation.js](../server/services/addressValidation.js) |
| Payments/inventory | [paymentService.js](../server/services/paymentService.js), [inventoryService.js](../server/services/inventoryService.js) |
| Order/return rules | [orderStatusPolicy.js](../server/services/orderStatusPolicy.js), [returnService.js](../server/services/returnService.js) |
| Shiprocket | [shippingService.js](../server/services/shippingService.js), [Shipment.js](../server/models/Shipment.js), [shiprocket.js](../server/config/shiprocket.js) |
| Shared product content | [ProductPageContent.js](../server/models/ProductPageContent.js), [product details template](../src/app/pages/product-details/product-details.component.html) |
| Email | [mailer.js](../server/config/mailer.js), [orderConfirmationEmail.js](../server/services/orderConfirmationEmail.js) |
| Maintenance | [securityMaintenance.js](../server/services/securityMaintenance.js), [maintenance route](../server/routes/maintenance.js) |
| Security headers | [httpSecurity.js](../server/config/httpSecurity.js) |
| Existing operational guides | [Production security](production-security.md), [Shiprocket](shiprocket.md) |

Maintain this document alongside changes to routes, schema, authentication, provider behavior and deployment configuration. Update its baseline/date and distinguish new implementation from planned work.
