-- Repair databases where 009_returns_workflow was recorded before the
-- item-level comments column was added to that migration.
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS comments TEXT;
