-- Delivery contact emails are distinct from account credentials.  They are used
-- only for fulfillment/tracking and are immutable once copied to an order.
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE order_addresses ADD COLUMN IF NOT EXISTS email VARCHAR(254);

-- Preserve convenience for existing customers who already have a verified
-- account email.  Phone-only legacy addresses remain editable but are not
-- silently assigned the store's email address.
UPDATE customer_addresses ca
SET email = LOWER(TRIM(u.email))
FROM users u
WHERE ca.user_id = u.id
  AND ca.email IS NULL
  AND u.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';

UPDATE order_addresses oa
SET email = LOWER(TRIM(u.email))
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE oa.order_id = o.id
  AND oa.email IS NULL
  AND u.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
