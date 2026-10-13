-- A replacement request can contain several order items.  The requested size
-- belongs to each item, not to the request as a whole.  Legacy single-item
-- requests retain their existing return_requests.requested_replacement_size.
ALTER TABLE return_items
  ADD COLUMN IF NOT EXISTS replacement_size VARCHAR(50);
