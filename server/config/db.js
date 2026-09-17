const { Pool } = require('pg');
const { readFileSync } = require('fs');
const path = require('path');
const { adminGoogleEmail } = require('./security');
const { assertProductionDatabaseRole } = require('./databasePermissions');

function createPoolConfig(environment = process.env) {
  const connectionString = environment.DATABASE_URL?.trim();
  if (connectionString) {
    // Neon supplies TLS and channel-binding requirements in DATABASE_URL.
    // Do not override them with a separate ssl object.
    return { connectionString };
  }

  return {
    host: environment.DB_HOST || 'localhost',
    port: Number(environment.DB_PORT) || 5432,
    database: environment.DB_NAME || 'monkhagen',
    user: environment.DB_USER || 'postgres',
    password: environment.DB_PASSWORD || '',
    ssl: environment.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false
  };
}

const pool = new Pool(createPoolConfig());

async function initSchema(database = pool) {
  await database.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    /* =========================================================
       ROLES
       customer     -> phone + OTP
       admin        -> designated verified Google account
       super_admin  -> equivalent legacy role; same Google-only policy
    ========================================================== */

    CREATE TABLE IF NOT EXISTS roles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(50) UNIQUE NOT NULL,
      description VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO roles (name, description)
    VALUES
      ('customer', 'Regular customer'),
      ('admin', 'Administrator'),
      ('super_admin', 'Super administrator')
    ON CONFLICT (name) DO NOTHING;


    /* =========================================================
       USERS
       Customers, admins and super admins all live here.

       CUSTOMER:
         phone required
         password_hash normally NULL
         login via OTP

       ADMIN / SUPER ADMIN:
         email required
         password_hash unused
         login via designated verified Google account only
    ========================================================== */

    CREATE TABLE IF NOT EXISTS users (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      role_id         UUID NOT NULL
                      REFERENCES roles(id),

      name            VARCHAR(255),

      email           VARCHAR(255),
      phone           VARCHAR(16),

      password_hash   VARCHAR(255),

      phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified  BOOLEAN NOT NULL DEFAULT FALSE,

      is_active       BOOLEAN NOT NULL DEFAULT TRUE,

      last_login_at   TIMESTAMPTZ,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_user_has_login_identifier
      CHECK (phone IS NOT NULL OR email IS NOT NULL)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
      ON users (LOWER(email))
      WHERE email IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone
      ON users (phone)
      WHERE phone IS NOT NULL;


    /* =========================================================
       CUSTOMER ADDRESSES
       One customer can save multiple delivery addresses.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS customer_addresses (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      user_id         UUID NOT NULL
                      REFERENCES users(id)
                      ON DELETE CASCADE,

      full_name       VARCHAR(255) NOT NULL,
      phone           VARCHAR(16) NOT NULL,

      address_line1   VARCHAR(255) NOT NULL,
      address_line2   VARCHAR(255),
      landmark        VARCHAR(255),

      city            VARCHAR(100) NOT NULL,
      state           VARCHAR(100) NOT NULL,
      postal_code     VARCHAR(10) NOT NULL,
      country         VARCHAR(100) NOT NULL DEFAULT 'India',

      address_type    VARCHAR(30) NOT NULL DEFAULT 'Home',
      is_default      BOOLEAN NOT NULL DEFAULT FALSE,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customer_addresses_user
      ON customer_addresses(user_id);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_default_address_per_user
      ON customer_addresses(user_id)
      WHERE is_default = TRUE;


    /* =========================================================
       CATEGORIES
       One category -> many products.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS categories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      name            VARCHAR(255) UNIQUE NOT NULL,
      slug            VARCHAR(255) UNIQUE NOT NULL,

      image           TEXT NOT NULL DEFAULT '',
      description     TEXT NOT NULL DEFAULT '',

      is_active       BOOLEAN NOT NULL DEFAULT TRUE,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS badges (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) UNIQUE NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sizes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(50) UNIQUE NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS colors (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) UNIQUE NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    /* =========================================================
       PRODUCTS
    ========================================================== */

    CREATE TABLE IF NOT EXISTS products (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      category_id     UUID NOT NULL
                      REFERENCES categories(id),

      name            VARCHAR(255) NOT NULL,
      slug            VARCHAR(255) UNIQUE NOT NULL,
      description     TEXT NOT NULL DEFAULT '',

      base_price      NUMERIC(10,2)
                      NOT NULL
                      CHECK (base_price >= 0),

      featured        BOOLEAN NOT NULL DEFAULT FALSE,
      badge           VARCHAR(100) NOT NULL DEFAULT '',
      badge_id        UUID REFERENCES badges(id) ON DELETE SET NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_category
      ON products(category_id);

    /* Product-to-size and product-to-color selections. */
    CREATE TABLE IF NOT EXISTS product_size_details (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size_id     UUID NOT NULL REFERENCES sizes(id) ON DELETE RESTRICT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, size_id)
    );

    CREATE TABLE IF NOT EXISTS product_color_details (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      color_id    UUID NOT NULL REFERENCES colors(id) ON DELETE RESTRICT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, color_id)
    );

    CREATE INDEX IF NOT EXISTS idx_product_size_details_product
      ON product_size_details(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_color_details_product
      ON product_color_details(product_id);


    /* =========================================================
       PRODUCT IMAGES
       Cloudinary URLs / public IDs are stored here.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS product_images (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      product_id            UUID NOT NULL
                            REFERENCES products(id)
                            ON DELETE CASCADE,

      image_url             TEXT NOT NULL,
      cloudinary_public_id  VARCHAR(255),

      display_order         INTEGER NOT NULL DEFAULT 0,
      is_primary            BOOLEAN NOT NULL DEFAULT FALSE,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_product_images_product
      ON product_images(product_id);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_primary_image_per_product
      ON product_images(product_id)
      WHERE is_primary = TRUE;


    /* =========================================================
       PRODUCT VARIANTS
       Stock is maintained at size/color level.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS product_variants (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      product_id      UUID NOT NULL
                      REFERENCES products(id)
                      ON DELETE CASCADE,

      size            VARCHAR(50) NOT NULL,
      color           VARCHAR(100) NOT NULL,
      size_id         UUID REFERENCES sizes(id) ON DELETE RESTRICT,
      color_id        UUID REFERENCES colors(id) ON DELETE RESTRICT,

      sku             VARCHAR(100) UNIQUE,

      price           NUMERIC(10,2)
                      CHECK (price >= 0),

      stock           INTEGER NOT NULL DEFAULT 0
                      CHECK (stock >= 0),

      is_active       BOOLEAN NOT NULL DEFAULT TRUE,

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(product_id, size, color)
    );

    CREATE INDEX IF NOT EXISTS idx_product_variants_product
      ON product_variants(product_id);

    /* =========================================================
       CARTS
       Persistent cart so a logged-in customer sees it later.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS carts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      user_id         UUID NOT NULL
                      REFERENCES users(id)
                      ON DELETE CASCADE,

      status          VARCHAR(30) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'converted', 'abandoned')),

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_carts_user
      ON carts(user_id);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_cart_per_user
      ON carts(user_id)
      WHERE status = 'active';


    /* =========================================================
       CART ITEMS
    ========================================================== */

    CREATE TABLE IF NOT EXISTS cart_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      cart_id         UUID NOT NULL
                      REFERENCES carts(id)
                      ON DELETE CASCADE,

      product_id      UUID NOT NULL
                      REFERENCES products(id),

      variant_id      UUID NOT NULL
                      REFERENCES product_variants(id),

      quantity        INTEGER NOT NULL DEFAULT 1
                      CHECK (quantity > 0),

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(cart_id, variant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cart_items_cart
      ON cart_items(cart_id);


    /* =========================================================
       ORDERS
       Never trust totals sent by Angular.
       Node.js must calculate price/discount/total from DB data.
    ========================================================== */

    CREATE TABLE IF NOT EXISTS orders (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      user_id             UUID NOT NULL
                          REFERENCES users(id),

      order_number        VARCHAR(50) UNIQUE NOT NULL,

      subtotal            NUMERIC(10,2) NOT NULL
                          CHECK (subtotal >= 0),

      discount_amount     NUMERIC(10,2) NOT NULL DEFAULT 0
                          CHECK (discount_amount >= 0),

      shipping_amount     NUMERIC(10,2) NOT NULL DEFAULT 0
                          CHECK (shipping_amount >= 0),

      total_amount        NUMERIC(10,2) NOT NULL
                          CHECK (total_amount >= 0),

      payment_method      VARCHAR(50),

      payment_status      VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (
                            payment_status IN
                            ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')
                          ),

      order_status        VARCHAR(50) NOT NULL DEFAULT 'placed'
                          CHECK (
                            order_status IN
                            ('placed', 'confirmed', 'processing', 'shipped',
                             'delivered', 'cancelled', 'return_requested',
                             'returned')
                          ),

      razorpay_order_id   VARCHAR(255),
      razorpay_payment_id VARCHAR(255),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user
      ON orders(user_id);

    CREATE INDEX IF NOT EXISTS idx_orders_created_at
      ON orders(created_at DESC);


    /* =========================================================
       ORDER ADDRESS SNAPSHOT
    ========================================================== */

    CREATE TABLE IF NOT EXISTS order_addresses (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      order_id        UUID NOT NULL UNIQUE
                      REFERENCES orders(id)
                      ON DELETE CASCADE,

      full_name       VARCHAR(255) NOT NULL,
      phone           VARCHAR(16) NOT NULL,

      address_line1   VARCHAR(255) NOT NULL,
      address_line2   VARCHAR(255),
      landmark        VARCHAR(255),

      city            VARCHAR(100) NOT NULL,
      state           VARCHAR(100) NOT NULL,
      postal_code     VARCHAR(10) NOT NULL,
      country         VARCHAR(100) NOT NULL DEFAULT 'India',

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    /* =========================================================
       ORDER ITEMS
    ========================================================== */

    CREATE TABLE IF NOT EXISTS order_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      order_id        UUID NOT NULL
                      REFERENCES orders(id)
                      ON DELETE CASCADE,

      product_id      UUID
                      REFERENCES products(id),

      variant_id      UUID
                      REFERENCES product_variants(id),

      product_name    VARCHAR(255) NOT NULL,
      sku             VARCHAR(100),

      size            VARCHAR(50),
      color           VARCHAR(100),

      quantity        INTEGER NOT NULL
                      CHECK (quantity > 0),

      unit_price      NUMERIC(10,2) NOT NULL
                      CHECK (unit_price >= 0),

      total_price     NUMERIC(10,2) NOT NULL
                      CHECK (total_price >= 0),

      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order
      ON order_items(order_id);


    /* =========================================================
       RETURN REQUESTS
    ========================================================== */

    CREATE TABLE IF NOT EXISTS return_requests (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      order_id          UUID NOT NULL
                        REFERENCES orders(id),

      user_id           UUID NOT NULL
                        REFERENCES users(id),

      return_number     VARCHAR(50) UNIQUE NOT NULL,

      reason            TEXT,
      comments          TEXT,

      status            VARCHAR(50) NOT NULL DEFAULT 'requested'
                        CHECK (
                          status IN
                          ('requested', 'approved', 'rejected',
                           'pickup_scheduled', 'received', 'completed', 'cancelled')
                        ),

      refund_amount     NUMERIC(10,2) NOT NULL DEFAULT 0
                        CHECK (refund_amount >= 0),

      refund_status     VARCHAR(50) NOT NULL DEFAULT 'pending'
                        CHECK (
                          refund_status IN
                          ('pending', 'processing', 'refunded', 'failed', 'not_applicable')
                        ),

      requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at       TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_return_requests_user
      ON return_requests(user_id);

    CREATE INDEX IF NOT EXISTS idx_return_requests_order
      ON return_requests(order_id);


    /* =========================================================
       RETURN ITEMS
    ========================================================== */

    CREATE TABLE IF NOT EXISTS return_items (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      return_request_id   UUID NOT NULL
                          REFERENCES return_requests(id)
                          ON DELETE CASCADE,

      order_item_id       UUID NOT NULL
                          REFERENCES order_items(id),

      quantity            INTEGER NOT NULL
                          CHECK (quantity > 0),

      reason              TEXT,

      refund_amount       NUMERIC(10,2) NOT NULL DEFAULT 0
                          CHECK (refund_amount >= 0),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(return_request_id, order_item_id)
    );

  `);

  // Preserve existing text badges while moving product editing to badge IDs.
  await database.query(`
    CREATE TABLE IF NOT EXISTS badges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS badge_id UUID REFERENCES badges(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_products_badge ON products(badge_id);
  `);
  await database.query(`
    INSERT INTO badges (name)
    SELECT DISTINCT TRIM(badge)
    FROM products
    WHERE TRIM(badge) <> ''
    ON CONFLICT (name) DO NOTHING;

    UPDATE products p
    SET badge_id = b.id
    FROM badges b
    WHERE p.badge_id IS NULL AND LOWER(b.name) = LOWER(TRIM(p.badge));
  `);

  // Normalize existing size/color text into admin-managed option tables.
  await database.query(`
    CREATE TABLE IF NOT EXISTS sizes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(50) UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS colors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) UNIQUE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS size_id UUID REFERENCES sizes(id) ON DELETE RESTRICT;
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS color_id UUID REFERENCES colors(id) ON DELETE RESTRICT;
    CREATE INDEX IF NOT EXISTS idx_product_variants_size ON product_variants(size_id);
    CREATE INDEX IF NOT EXISTS idx_product_variants_color ON product_variants(color_id);
  `);
  await database.query(`
    INSERT INTO sizes (name)
    SELECT DISTINCT TRIM(size) FROM product_variants WHERE TRIM(size) <> ''
    ON CONFLICT (name) DO NOTHING;
    INSERT INTO colors (name)
    SELECT DISTINCT TRIM(color) FROM product_variants WHERE TRIM(color) <> ''
    ON CONFLICT (name) DO NOTHING;

    UPDATE product_variants pv
    SET size_id = s.id
    FROM sizes s
    WHERE pv.size_id IS NULL AND LOWER(s.name) = LOWER(TRIM(pv.size));
    UPDATE product_variants pv
    SET color_id = c.id
    FROM colors c
    WHERE pv.color_id IS NULL AND LOWER(c.name) = LOWER(TRIM(pv.color));
  `);

  // Explicit one-to-many product selections, independent of stock variants.
  await database.query(`
    CREATE TABLE IF NOT EXISTS product_size_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size_id UUID NOT NULL REFERENCES sizes(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, size_id)
    );
    CREATE TABLE IF NOT EXISTS product_color_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      color_id UUID NOT NULL REFERENCES colors(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, color_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_size_details_product
      ON product_size_details(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_color_details_product
      ON product_color_details(product_id);
  `);
  await database.query(`
    INSERT INTO product_size_details (product_id, size_id)
    SELECT DISTINCT product_id, size_id
    FROM product_variants
    WHERE size_id IS NOT NULL
    ON CONFLICT (product_id, size_id) DO NOTHING;

    INSERT INTO product_color_details (product_id, color_id)
    SELECT DISTINCT product_id, color_id
    FROM product_variants
    WHERE color_id IS NOT NULL
    ON CONFLICT (product_id, color_id) DO NOTHING;
  `);

  // Safe migrations — add Google auth columns to existing deployments
  await database.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_uid    VARCHAR(128);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid  VARCHAR(128);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;

    UPDATE users
    SET firebase_uid = google_uid
    WHERE firebase_uid IS NULL AND google_uid IS NOT NULL;
  `);
  await database.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_number   VARCHAR(100);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_name VARCHAR(100);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at   TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
  `);
  // Razorpay payment lifecycle and idempotency metadata. All changes are additive.
  await database.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cart_id UUID REFERENCES carts(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_token UUID;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_checkout_token
      ON orders(checkout_token) WHERE checkout_token IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_razorpay_order_id
      ON orders(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_razorpay_payment_id
      ON orders(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_cart ON orders(cart_id);

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      event_id       VARCHAR(255) PRIMARY KEY,
      event_type     VARCHAR(100) NOT NULL,
      processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS credit_accounts (
      user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type            VARCHAR(10) NOT NULL CHECK (type IN ('CREDIT','DEBIT')),
      amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      reason          VARCHAR(255) NOT NULL,
      reference_type  VARCHAR(50),
      reference_id    VARCHAR(255),
      expires_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await database.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_uid
      ON users (google_uid)
      WHERE google_uid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_firebase_uid
      ON users (firebase_uid)
      WHERE firebase_uid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user
      ON credit_transactions(user_id);
  `);
}

async function applyShippingMigration(database = pool) {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '001_shipments.sql'), 'utf8');
  await database.query(sql);
}

async function applyFirebaseAuthMigration(database = pool) {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '002_firebase_auth.sql'), 'utf8');
  await database.query(sql);
}

async function applyProductPageContentMigration(database = pool) {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '003_product_page_content.sql'), 'utf8');
  await database.query(sql);
}

async function applySizeChartCareMigration(database = pool) {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '004_size_chart_care_content.sql'), 'utf8');
  await database.query(sql);
}

async function applyGoogleAdminMigration(database = pool) {
  // Retain account records and their business history. Remove all privileged
  // passwords and disable identities outside the configured Google account.
  await database.query(`
    UPDATE users u
    SET password_hash = NULL,
        is_active = CASE WHEN LOWER(TRIM(u.email)) = $1 THEN u.is_active ELSE FALSE END,
        updated_at = NOW()
    FROM roles r
    WHERE u.role_id = r.id AND r.name IN ('admin', 'super_admin')
  `, [adminGoogleEmail()]);
}

async function applySecurityIntegrityMigration(database = pool) {
  await database.query(readFileSync(path.join(__dirname, '..', 'migrations', '006_security_integrity.sql'), 'utf8'));
}

async function runMigration(name, migrate, databasePool = pool) {
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('monkhagen:schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const existing = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [name]
    );
    if (existing.rows.length === 0) {
      await migrate(client);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    await client.query('COMMIT');
    return existing.rows.length === 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function connectDB({ migrate = process.env.NODE_ENV !== 'production' } = {}) {
  try {
    await pool.query('SELECT NOW()');

    const source = process.env.DATABASE_URL?.trim()
      ? 'DATABASE_URL'
      : 'individual DB_* variables';
    console.log(`PostgreSQL connected using ${source}`);

    if (!migrate) {
      await assertProductionDatabaseRole(pool);
      console.log('Production database role verified; migrations are managed separately.');
      return;
    }

    const baseApplied = await runMigration('000_base_schema', initSchema);
    const shippingApplied = await runMigration('001_shipments', applyShippingMigration);
    const firebaseAuthApplied = await runMigration('002_firebase_auth', applyFirebaseAuthMigration);
    const productPageContentApplied = await runMigration('003_product_page_content', applyProductPageContentMigration);
    const sizeChartCareApplied = await runMigration('004_size_chart_care_content', applySizeChartCareMigration);
    const googleAdminApplied = await runMigration('005_google_only_admin', applyGoogleAdminMigration);
    const integrityApplied = await runMigration('006_security_integrity', applySecurityIntegrityMigration);
    const sessionsApplied = await runMigration('007_session_revocation', database =>
      database.query(readFileSync(path.join(__dirname, '..', 'migrations', '007_session_revocation.sql'), 'utf8')));

    console.log(
      baseApplied || shippingApplied || firebaseAuthApplied || productPageContentApplied || sizeChartCareApplied || googleAdminApplied || integrityApplied || sessionsApplied
        ? 'Database migrations applied successfully'
        : 'Database schema is up to date'
    );
  } catch (err) {
    console.error('Database startup failed:', { code: err.code || 'DB_STARTUP_FAILED' });
    if (err.code === 'DB_ROLE_UNSAFE') console.error('Use a restricted application database role in production; migrate separately.');

    throw err;
  }
}

module.exports = {
  pool,
  createPoolConfig,
  connectDB,
  initSchema,
  applyShippingMigration,
  applyFirebaseAuthMigration,
  applyProductPageContentMigration,
  applySizeChartCareMigration,
  applyGoogleAdminMigration,
  applySecurityIntegrityMigration,
  runMigration
};
