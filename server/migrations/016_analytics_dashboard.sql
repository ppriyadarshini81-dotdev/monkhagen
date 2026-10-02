-- Extend the privacy-minimised analytics foundation with active engagement,
-- internal-traffic exclusion and sanitized diagnostic metadata.
ALTER TABLE analytics_sessions
  ADD COLUMN IF NOT EXISTS active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  ADD COLUMN IF NOT EXISTS exit_path VARCHAR(512),
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check CHECK (event_type IN (
  'SESSION_STARTED', 'PAGE_VIEW', 'PRODUCT_VIEWED', 'ADD_TO_CART',
  'REMOVE_FROM_CART', 'CART_VIEWED', 'CHECKOUT_STARTED', 'ADDRESS_SELECTED',
  'PAYMENT_STARTED', 'PAYMENT_WINDOW_CLOSED', 'PAYMENT_SUCCESS',
  'PAYMENT_FAILED', 'ORDER_CREATED', 'LOGIN', 'SIGNUP', 'LOGOUT', 'FRONTEND_ERROR'
));

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_customer_period
  ON analytics_sessions(started_at DESC, visitor_id) WHERE is_internal = FALSE;
CREATE INDEX IF NOT EXISTS idx_analytics_events_error_time
  ON analytics_events(occurred_at DESC, session_id) WHERE event_type = 'FRONTEND_ERROR';
CREATE INDEX IF NOT EXISTS idx_analytics_events_login_user_time
  ON analytics_events(user_id, occurred_at DESC) WHERE event_type IN ('LOGIN','SIGNUP');

-- Sessions already linked to a privileged account can be excluded safely.
-- Anonymous activity predating the link cannot be guessed and is preserved.
UPDATE analytics_sessions s SET is_internal = TRUE
FROM users u JOIN roles r ON r.id = u.role_id
WHERE s.user_id = u.id AND r.name IN ('admin','super_admin');
