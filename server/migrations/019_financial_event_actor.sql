-- Repair deployments where migration 018 was recorded before its later
-- financial-event attribution addition existed. Kept as a separate migration
-- because applied migration files must be treated as immutable.
ALTER TABLE financial_transaction_events
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

