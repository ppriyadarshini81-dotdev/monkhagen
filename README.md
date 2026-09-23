# Monk Hagen

Monk Hagen is a premium streetwear storefront built as one Angular application with an Express API.

## Documentation

For the current frontend-on-Cloudflare / backend-on-Render setup, see the [Cloudflare deployment guide](docs/cloudflare-frontend.md).

See the [website design and functionality document](docs/website-design-and-functionality.md) for the current high-level/low-level design, module-wise functionality, integrations, security changes, development history and deployment checklist. The [documentation index](docs/README.md) links the operational guides. Some quick-start statements below are historical; consult the dated design document for current authentication and production behavior.

## Stack

- Angular 20 standalone components
- Node.js 20.19+ and Express 4
- PostgreSQL with the `pg` driver
- Firebase Google sign-in and application JWTs
- Razorpay payments and signed webhooks
- Shiprocket fulfillment and tracking
- Cloudflare R2 media storage
- Nodemailer for contact and order-confirmation email

## Features

- Public home, catalog, product-detail, about, contact, and refund-policy pages
- Product variants by managed size and color, stock, categories, badges, and images
- Authenticated PostgreSQL cart and saved customer addresses
- Razorpay checkout with server-side capture verification and idempotency
- Retried customer confirmations with blind-copy notifications to the store inbox
- Customer profile, orders, tracking, returns, and store credits
- Admin management for catalog data, inventory, orders, and media
- Durable Shiprocket shipment queue with explicit AWB, pickup, label, and reconciliation operations

## Project layout

```text
src/app/
  components/     Shared header, footer, and product cards
  pages/          Lazy-loaded storefront, account, cart, login, and admin pages
  services/       HTTP clients, authentication, cart, payment, and UI state
  models/         Frontend API contracts

server/
  config/         PostgreSQL and third-party service configuration
  controllers/    HTTP request handlers
  middleware/     JWT authorization and error handling
  models/         PostgreSQL query/data-access modules
  routes/         Express API routes
  services/       Payments, email, address validation, and shipping workflows
  migrations/     Versioned SQL migrations
  tests/          Node test-runner suites
```

## Configuration

Create a root `.env` file. It is ignored by Git. Production deployments must set:

```dotenv
NODE_ENV=production
PORT=3000

DB_HOST=
DB_PORT=5432
DB_NAME=monkhagen
DB_USER=
DB_PASSWORD=

# At least 32 characters. The server refuses to start without it in production.
JWT_SECRET=
JWT_EXPIRES_IN=1d

# Comma-separated browser origins, for example https://monkhagen.com
CORS_ORIGINS=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ADMIN_GOOGLE_EMAIL=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=monkhagen-media
R2_PUBLIC_URL=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
CONTACT_EMAIL=official@monkhagen.in
```

The `CONTACT_EMAIL` address receives contact-form submissions and a blind copy of each paid-order confirmation. For Zoho-hosted `@monkhagen.in` mailboxes, use `smtp.zoho.in`, port `465`, `SMTP_SECURE=true`, and a Zoho application-specific password when two-factor authentication is enabled.

Shiprocket variables and operational setup are documented in [docs/shiprocket.md](docs/shiprocket.md).

Google is the normal customer sign-in path. Deprecated OTP routes are disabled by default. For a temporary legacy integration, set `ENABLE_LEGACY_OTP=true` and configure MSG91. Local development without MSG91 additionally requires an explicit six-digit `DEV_OTP_CODE`; this fallback is unavailable in production.

## Install and run

Use Node.js 20.19 or newer, then run:

```bash
npm install
npm run dev
```

- Angular development server: `http://localhost:4200`
- Express API: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health`

Angular proxies `/api` to Express during development. For a production-style local run:

```bash
npm run start:prod
```

Express serves the compiled Angular browser bundle and the API from port 3000.

## Database migrations and seed data

On startup, the backend creates `schema_migrations`, acquires a PostgreSQL advisory lock, and applies each pending migration exactly once. Existing installations are upgraded through the same idempotent migrations.

To populate disposable development data:

```bash
npm run seed
```

Warning: seeding deletes existing application data and installs predictable development admin credentials. Never run it against a production database.

## Tests

```bash
npm test
npm run test:shipping
```

The optional PostgreSQL shipping test creates an isolated schema inside a transaction and rolls it back:

```powershell
$env:SHIPPING_DB_TESTS = '1'
node --test server/tests/shippingDatabase.test.js
```

## API overview

- `/api/products`, `/api/categories`, `/api/badges`, `/api/sizes`, `/api/colors`
- `/api/auth`, `/api/account`, `/api/cart`, `/api/orders`
- `/api/payments` and `/api/webhooks/razorpay`
- `/api/shipping`
- `/api/upload`, `/api/media`, `/api/contact`

All catalog mutations, uploads, order administration, and fulfillment operations require an administrator JWT. Customer account, cart, payment, and order operations require an authenticated customer JWT.
