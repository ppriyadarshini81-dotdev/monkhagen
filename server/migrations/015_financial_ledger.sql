-- Durable order financial ledger. Monetary movements are stored once while
-- status changes are preserved in the separate event table.
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_key VARCHAR(255) NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES orders(id),
  return_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN ('PAYMENT','COD_PAYMENT','REFUND','ADJUSTMENT')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED')),
  payment_method VARCHAR(30) CHECK (payment_method IN ('RAZORPAY','COD','MANUAL')),
  provider VARCHAR(30) CHECK (provider IN ('RAZORPAY','COD','MANUAL')),
  provider_reference_id VARCHAR(255),
  description VARCHAR(500) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_reference
  ON financial_transactions(provider, provider_reference_id, transaction_type)
  WHERE provider_reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_return_refund
  ON financial_transactions(return_id, transaction_type)
  WHERE return_id IS NOT NULL AND transaction_type = 'REFUND';
CREATE INDEX IF NOT EXISTS idx_financial_transactions_occurred
  ON financial_transactions(occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_order
  ON financial_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_status_direction
  ON financial_transactions(status, direction);

CREATE TABLE IF NOT EXISTS financial_transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES financial_transactions(id) ON DELETE CASCADE,
  event_key VARCHAR(320) NOT NULL UNIQUE,
  previous_status VARCHAR(20) CHECK (previous_status IS NULL OR previous_status IN ('PENDING','SUCCESS','FAILED','CANCELLED')),
  new_status VARCHAR(20) NOT NULL CHECK (new_status IN ('PENDING','SUCCESS','FAILED','CANCELLED')),
  event_type VARCHAR(80) NOT NULL,
  provider_event_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_financial_events_transaction
  ON financial_transaction_events(transaction_id, created_at, id);

-- A captured Razorpay payment ID plus paid_at is authoritative enough to
-- reconstruct successful incoming payment transactions.
INSERT INTO financial_transactions
  (transaction_key, order_id, transaction_type, direction, amount, currency, status,
   payment_method, provider, provider_reference_id, description, occurred_at)
SELECT 'PAYMENT:' || o.id, o.id, 'PAYMENT', 'CREDIT', o.total_amount, 'INR', 'SUCCESS',
       'RAZORPAY', 'RAZORPAY', o.razorpay_payment_id, 'Captured Razorpay order payment', o.paid_at
FROM orders o
WHERE o.payment_method = 'razorpay' AND o.razorpay_payment_id IS NOT NULL
  AND o.paid_at IS NOT NULL AND o.payment_status IN ('paid','partially_refunded','refunded')
  AND o.total_amount > 0
ON CONFLICT DO NOTHING;

-- COD creation proves only that cash is expected, not that Monk Hagen has
-- received or been remitted the money. These entries intentionally remain
-- excluded from successful-credit totals.
INSERT INTO financial_transactions
  (transaction_key, order_id, transaction_type, direction, amount, currency, status,
   payment_method, provider, description, occurred_at)
SELECT 'COD_PAYMENT:' || o.id, o.id, 'COD_PAYMENT', 'CREDIT', o.total_amount, 'INR',
       CASE WHEN o.order_status = 'cancelled' THEN 'CANCELLED' ELSE 'PENDING' END,
       'COD', 'COD', 'Expected COD collection; remittance not yet confirmed', o.created_at
FROM orders o
WHERE o.payment_method = 'cod' AND o.total_amount > 0
ON CONFLICT DO NOTHING;

-- payment_refunds contains only signed refund.processed outcomes. Link to a
-- return where possible; independent partial refunds remain separate by their
-- Razorpay refund ID.
INSERT INTO financial_transactions
  (transaction_key, order_id, return_id, transaction_type, direction, amount, currency, status,
   payment_method, provider, provider_reference_id, description, occurred_at)
SELECT CASE WHEN rr.id IS NOT NULL THEN 'REFUND:RETURN:' || rr.id ELSE 'REFUND:RAZORPAY:' || pr.refund_id END,
       pr.order_id, rr.id, 'REFUND', 'DEBIT', pr.amount, 'INR', 'SUCCESS',
       'RAZORPAY', 'RAZORPAY', pr.refund_id, 'Processed Razorpay refund', pr.processed_at
FROM payment_refunds pr
LEFT JOIN return_requests rr ON rr.razorpay_refund_id = pr.refund_id
WHERE pr.amount > 0
ON CONFLICT DO NOTHING;

-- A provider refund ID with a processing local state is safe to represent as
-- one pending debit. It will be updated, never duplicated, by the webhook.
INSERT INTO financial_transactions
  (transaction_key, order_id, return_id, transaction_type, direction, amount, currency, status,
   payment_method, provider, provider_reference_id, description, occurred_at)
SELECT 'REFUND:RETURN:' || rr.id, rr.order_id, rr.id, 'REFUND', 'DEBIT', rr.refund_amount,
       'INR', 'PENDING', 'RAZORPAY', 'RAZORPAY', rr.razorpay_refund_id,
       'Razorpay refund awaiting confirmation', COALESCE(rr.refund_initiated_at, rr.updated_at)
FROM return_requests rr
JOIN orders o ON o.id = rr.order_id
LEFT JOIN payment_refunds pr ON pr.refund_id = rr.razorpay_refund_id
WHERE o.payment_method = 'razorpay' AND rr.razorpay_refund_id IS NOT NULL
  AND rr.refund_amount > 0 AND rr.refund_status IN ('pending','processing')
  AND pr.refund_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO financial_transaction_events
  (transaction_id, event_key, previous_status, new_status, event_type, provider_event_id, created_at)
SELECT ft.id, 'BACKFILL:' || ft.transaction_key || ':' || ft.status, NULL, ft.status,
       'HISTORICAL_BACKFILL', ft.provider_reference_id, ft.created_at
FROM financial_transactions ft
ON CONFLICT (event_key) DO NOTHING;
