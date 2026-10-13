-- Eligibility policy fields are additive. Existing legacy returns retain their
-- original refund values and are treated as normal returns for display only.
ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) NOT NULL DEFAULT 'return',
  ADD COLUMN IF NOT EXISTS requested_replacement_size VARCHAR(50),
  ADD COLUMN IF NOT EXISTS return_shipping_deduction NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligibility_override_id UUID;

ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_request_type_check;
ALTER TABLE return_requests ADD CONSTRAINT return_requests_request_type_check
  CHECK (request_type IN ('return', 'defect', 'replacement'));
ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_shipping_deduction_check;
ALTER TABLE return_requests ADD CONSTRAINT return_requests_shipping_deduction_check
  CHECK (return_shipping_deduction >= 0);

CREATE TABLE IF NOT EXISTS return_eligibility_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('return', 'defect', 'replacement')),
  reason VARCHAR(500) NOT NULL CHECK (length(trim(reason)) >= 5),
  granted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_eligibility_override_active
  ON return_eligibility_overrides(order_id, user_id, request_type) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_return_eligibility_overrides_customer
  ON return_eligibility_overrides(user_id, order_id, granted_at DESC);

ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_eligibility_override_fk;
ALTER TABLE return_requests
  ADD CONSTRAINT return_requests_eligibility_override_fk
  FOREIGN KEY (eligibility_override_id) REFERENCES return_eligibility_overrides(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS return_request_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID REFERENCES return_requests(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  reason VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_return_request_audit_return ON return_request_audit(return_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_return_request_audit_order ON return_request_audit(order_id, created_at);
