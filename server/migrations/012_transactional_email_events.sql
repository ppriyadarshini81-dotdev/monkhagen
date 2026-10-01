CREATE TABLE IF NOT EXISTS transactional_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  return_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  recipient VARCHAR(254) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error VARCHAR(100),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactional_email_pending
  ON transactional_email_events(next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_transactional_email_order
  ON transactional_email_events(order_id, event_type);
CREATE INDEX IF NOT EXISTS idx_transactional_email_return
  ON transactional_email_events(return_id, event_type);

CREATE TABLE IF NOT EXISTS shipment_webhook_events (
  event_id VARCHAR(64) PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
