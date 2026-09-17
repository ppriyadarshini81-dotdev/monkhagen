const crypto = require('node:crypto');
const { pool } = require('../config/db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_WINDOW_DAYS = 7;
function invalid(status, message) { return Object.assign(new Error(message), { status }); }

async function createReturn(userId, { orderId, reason, comments, items } = {}, database = pool) {
  if (!UUID.test(orderId || '') || typeof reason !== 'string' || !reason.trim() || reason.length > 1000 ||
      (comments != null && (typeof comments !== 'string' || comments.length > 2000)) ||
      !Array.isArray(items) || !items.length || items.length > 50) {
    throw invalid(400, 'A valid order, reason and return items are required.');
  }
  const ids = new Set();
  for (const item of items) {
    if (!item || !UUID.test(item.orderItemId || '') || ids.has(item.orderItemId.toLowerCase()) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
        (item.reason != null && (typeof item.reason !== 'string' || item.reason.length > 1000))) {
      throw invalid(400, 'Each return item needs a unique item ID and a valid positive quantity.');
    }
    ids.add(item.orderItemId.toLowerCase());
  }
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    // Serialize eligibility, ownership, duplicate checks and insertion together.
    const owned = await client.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, userId]);
    const order = owned.rows[0];
    if (!order) throw invalid(404, 'Order not found.');
    if (order.order_status !== 'delivered') throw invalid(400, 'Only delivered orders are eligible for return.');
    const delivered = new Date(order.delivered_at || order.updated_at).getTime();
    const age = Date.now() - delivered;
    if (!Number.isFinite(delivered) || age < 0 || age > RETURN_WINDOW_DAYS * 86400000) {
      throw invalid(400, 'The return window of 7 days has expired.');
    }
    const existing = await client.query(
      "SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected','cancelled')", [orderId]);
    if (existing.rows.length) throw invalid(409, 'A return request for this order already exists.');
    const purchased = await client.query(
      'SELECT id, quantity FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE',
      [orderId, [...ids]]);
    const quantities = new Map(purchased.rows.map(row => [row.id.toLowerCase(), row.quantity]));
    if (items.some(item => !quantities.has(item.orderItemId.toLowerCase()) ||
        item.quantity > quantities.get(item.orderItemId.toLowerCase()))) {
      throw invalid(400, 'Return items must belong to this order and cannot exceed the purchased quantities.');
    }
    const number = `RET-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
    const result = await client.query(
      'INSERT INTO return_requests (order_id, user_id, return_number, reason, comments) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [orderId, userId, number, reason.trim(), comments?.trim() || null]);
    const request = result.rows[0];
    for (const item of items) {
      await client.query('INSERT INTO return_items (return_request_id, order_item_id, quantity, reason) VALUES ($1,$2,$3,$4)',
        [request.id, item.orderItemId, item.quantity, item.reason?.trim() || null]);
    }
    await client.query("UPDATE orders SET order_status = 'return_requested', updated_at = NOW() WHERE id = $1 AND user_id = $2", [orderId, userId]);
    await client.query('COMMIT');
    return { ...request, items: items.map(item => ({ orderItemId: item.orderItemId, quantity: item.quantity, reason: item.reason?.trim() || null })) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { createReturn };
