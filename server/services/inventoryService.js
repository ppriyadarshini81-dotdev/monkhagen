const addressValidationError = require('./addressValidation');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function error(status, message) { return Object.assign(new Error(message), { status }); }
function paise(value) {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result < 0) throw error(400, 'An item has an invalid price.');
  return result;
}

async function checkoutSnapshot(client, userId, addressId) {
  if (!UUID.test(addressId || '')) throw error(400, 'Select a valid saved shipping address.');
  const carts = await client.query("SELECT id FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE", [userId]);
  const cart = carts.rows[0];
  if (!cart) throw error(400, 'Cart is empty.');
  const addresses = await client.query('SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2', [addressId, userId]);
  const address = addresses.rows[0];
  if (!address) throw error(400, 'Select a shipping address saved to your account.');
  const invalid = await addressValidationError({ fullName: address.full_name, phone: address.phone,
    addressLine1: address.address_line1, city: address.city, state: address.state,
    postalCode: address.postal_code, country: address.country });
  if (invalid) throw error(400, invalid);
  // The cart, prices, and stock are read and locked in the same transaction.
  // Variant ordering is stable to reduce deadlocks across customer carts.
  const result = await client.query(`
    SELECT ci.product_id, ci.variant_id, ci.quantity, p.name AS product_name,
      p.is_active AS product_active, c.is_active AS category_active,
      pv.is_active AS variant_active, pv.size, pv.color, pv.sku, pv.stock,
      COALESCE(pv.price, p.base_price) AS unit_price
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    JOIN categories c ON c.id = p.category_id
    JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
    WHERE ci.cart_id = $1 ORDER BY ci.variant_id FOR UPDATE OF ci, p, pv`, [cart.id]);
  const items = result.rows;
  if (!items.length || items.length > 50) throw error(400, 'Cart must contain between 1 and 50 items.');
  let amount = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw error(400, 'Invalid item quantity.');
    if (!item.product_active || !item.variant_active || !item.category_active) throw error(409, 'An item is no longer available.');
    if (item.stock < item.quantity) throw error(409, 'An item has insufficient stock.');
    amount += paise(item.unit_price) * item.quantity;
  }
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100000000) throw error(400, 'Cart total is outside the supported range.');
  return { cart, address, items, amount };
}

async function deduct(client, items) {
  for (const item of items) {
    if (!UUID.test(item.variant_id || '') || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 5000) {
      throw error(409, 'Order inventory needs review.');
    }
    const result = await client.query(`UPDATE product_variants SET stock = stock - $1, updated_at = NOW()
      WHERE id = $2 AND is_active = TRUE AND stock >= $1 RETURNING id`, [item.quantity, item.variant_id]);
    if (!result.rows.length) throw error(409, 'An item has insufficient stock.');
  }
}

async function snapshotItems(client, orderId, items) {
  for (const item of items) {
    const unitPrice = paise(item.unit_price);
    await client.query(`INSERT INTO order_items
      (order_id, product_id, variant_id, product_name, sku, size, color, quantity, unit_price, total_price)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [orderId, item.product_id, item.variant_id,
      item.product_name, item.sku, item.size, item.color, item.quantity,
      (unitPrice / 100).toFixed(2), (unitPrice * item.quantity / 100).toFixed(2)]);
  }
}
async function snapshotAddress(client, orderId, address) {
  await client.query(`INSERT INTO order_addresses
    (order_id, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [orderId, address.full_name, address.phone,
    address.address_line1, address.address_line2, address.landmark, address.city,
    address.state, address.postal_code, address.country]);
}

// The caller holds the order row lock. Mark release in the same transaction as
// stock restoration so retries cannot restore the same reservation twice.
async function releaseReservation(client, order) {
  if (!order.inventory_reserved_at || order.inventory_released_at || order.inventory_deducted_at) return;
  const items = await client.query('SELECT variant_id, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = $1 GROUP BY variant_id ORDER BY variant_id', [order.id]);
  for (const item of items.rows) {
    await client.query('UPDATE product_variants SET stock = stock + $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.variant_id]);
  }
  await client.query('UPDATE orders SET inventory_released_at = NOW(), updated_at = NOW() WHERE id = $1', [order.id]);
}

async function releaseExpiredReservations(client) {
  const orders = await client.query(`SELECT * FROM orders
    WHERE inventory_reserved_at IS NOT NULL AND inventory_released_at IS NULL
      AND inventory_deducted_at IS NULL AND payment_status IN ('pending','failed')
      AND inventory_reservation_expires_at <= NOW()
    ORDER BY inventory_reservation_expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`);
  for (const order of orders.rows) await releaseReservation(client, order);
  return orders.rows.length;
}
module.exports = { checkoutSnapshot, deduct, snapshotItems, snapshotAddress, releaseReservation, releaseExpiredReservations, error, UUID };
