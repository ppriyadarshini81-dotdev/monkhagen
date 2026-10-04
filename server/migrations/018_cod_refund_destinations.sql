-- Encrypted, return-scoped destinations for manual COD refunds. Sensitive
-- values are encrypted by the application before PostgreSQL receives them.
CREATE TABLE IF NOT EXISTS cod_refund_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL UNIQUE REFERENCES return_requests(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method VARCHAR(10) NOT NULL CHECK (method IN ('UPI','BANK')),
  account_holder_name_encrypted TEXT,
  account_number_encrypted TEXT,
  account_last4 CHAR(4),
  ifsc_encrypted TEXT,
  bank_name_encrypted TEXT,
  upi_id_encrypted TEXT,
  masked_destination VARCHAR(100) NOT NULL,
  encryption_key_version SMALLINT NOT NULL DEFAULT 1 CHECK (encryption_key_version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PROVIDED'
    CHECK (status IN ('PROVIDED','PROCESSING','FAILED','COMPLETED','REDACTED')),
  submission_version INTEGER NOT NULL DEFAULT 1 CHECK (submission_version > 0),
  processing_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempt_count >= 0),
  transaction_reference VARCHAR(100),
  internal_note VARCHAR(500),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  redacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    status = 'REDACTED' OR (
      method = 'UPI' AND upi_id_encrypted IS NOT NULL
        AND account_holder_name_encrypted IS NULL AND account_number_encrypted IS NULL AND ifsc_encrypted IS NULL
    ) OR (
      method = 'BANK' AND account_holder_name_encrypted IS NOT NULL
        AND account_number_encrypted IS NOT NULL AND ifsc_encrypted IS NOT NULL AND upi_id_encrypted IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cod_refund_transaction_reference
  ON cod_refund_destinations(transaction_reference) WHERE transaction_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cod_refund_destinations_user
  ON cod_refund_destinations(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_cod_refund_destinations_status
  ON cod_refund_destinations(status, updated_at);

CREATE TABLE IF NOT EXISTS cod_refund_destination_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_destination_id UUID NOT NULL REFERENCES cod_refund_destinations(id) ON DELETE RESTRICT,
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(50) NOT NULL CHECK (action = 'VIEWED_REFUND_DESTINATION'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cod_refund_access_destination
  ON cod_refund_destination_access_log(refund_destination_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cod_refund_access_admin
  ON cod_refund_destination_access_log(admin_user_id, created_at DESC);

ALTER TABLE financial_transaction_events
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
