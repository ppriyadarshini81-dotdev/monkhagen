-- First-party, privacy-minimised commerce analytics.
-- All timestamps are stored in UTC by PostgreSQL. Reporting applies the
-- configured Monk Hagen business timezone at query boundaries.

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id                         UUID PRIMARY KEY,
  visitor_id                 UUID NOT NULL,
  user_id                    UUID REFERENCES users(id) ON DELETE SET NULL,
  entry_path                 VARCHAR(512) NOT NULL DEFAULT '/',
  is_authenticated_at_start  BOOLEAN NOT NULL DEFAULT FALSE,
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                   TIMESTAMPTZ,
  page_views                 INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  product_views              INTEGER NOT NULL DEFAULT 0 CHECK (product_views >= 0)
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started
  ON analytics_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor
  ON analytics_sessions(visitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user
  ON analytics_sessions(user_id, started_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   VARCHAR(255) UNIQUE,
  session_id   UUID NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type   VARCHAR(50) NOT NULL CHECK (event_type IN (
    'SESSION_STARTED', 'PAGE_VIEW', 'PRODUCT_VIEWED', 'ADD_TO_CART',
    'REMOVE_FROM_CART', 'CART_VIEWED', 'CHECKOUT_STARTED', 'ADDRESS_SELECTED',
    'PAYMENT_STARTED', 'PAYMENT_WINDOW_CLOSED', 'PAYMENT_SUCCESS',
    'PAYMENT_FAILED', 'ORDER_CREATED', 'LOGIN', 'SIGNUP'
  )),
  path         VARCHAR(512),
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  cart_id      UUID REFERENCES carts(id) ON DELETE SET NULL,
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred
  ON analytics_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time
  ON analytics_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_time
  ON analytics_events(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_time
  ON analytics_events(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_product_type_time
  ON analytics_events(product_id, event_type, occurred_at DESC) WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gateway_payment_id  VARCHAR(255) NOT NULL UNIQUE,
  status              VARCHAR(20) NOT NULL CHECK (status IN ('successful', 'failed')),
  failure_category    VARCHAR(255),
  attempted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_time
  ON payment_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_time
  ON payment_attempts(status, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_order
  ON payment_attempts(order_id, attempted_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS analytics_session_id UUID
  REFERENCES analytics_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_analytics_session
  ON orders(analytics_session_id) WHERE analytics_session_id IS NOT NULL;
