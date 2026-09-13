-- Additive and repeatable; existing orders are not backfilled or shipped.
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  shiprocket_order_id BIGINT UNIQUE,
  shiprocket_shipment_id BIGINT UNIQUE,
  awb_code VARCHAR(100) UNIQUE,
  courier_id BIGINT,
  courier_name VARCHAR(255),
  shipping_status VARCHAR(100) NOT NULL DEFAULT 'pending',
  tracking_status VARCHAR(255),
  tracking_url TEXT,
  label_url TEXT,
  shipping_charge NUMERIC(10,2) CHECK (shipping_charge >= 0),
  estimated_delivery VARCHAR(100),
  pickup_status VARCHAR(100) NOT NULL DEFAULT 'pending',
  pickup_scheduled_date VARCHAR(100),
  pickup_location VARCHAR(255),
  package_weight NUMERIC(10,3) CHECK (package_weight > 0),
  package_length NUMERIC(10,2) CHECK (package_length > 0),
  package_breadth NUMERIC(10,2) CHECK (package_breadth > 0),
  package_height NUMERIC(10,2) CHECK (package_height > 0),
  -- Persist intent BEFORE remote mutations. An interrupted operation is never blindly replayed.
  pending_operation VARCHAR(30),
  operation_started_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tracking_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracking_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((shiprocket_order_id IS NULL) = (shiprocket_shipment_id IS NULL)),
  CHECK (pending_operation IS NULL OR pending_operation IN ('create','awb','pickup','label'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_pending
  ON shipments(next_attempt_at) WHERE shiprocket_order_id IS NULL AND pending_operation IS NULL;
