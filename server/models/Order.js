const { pool } = require('../config/db');
const Shipment = require('./Shipment');
const inventory = require('../services/inventoryService');
const { validateTransition } = require('../services/orderStatusPolicy');

const COD_FEE_PAISE = 10000;

function genOrderNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MH-${d}-${r}`;
}

function formatItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productName: row.product_name,
    sku: row.sku || null,
    size: row.size || null,
    color: row.color || null,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    totalPrice: Number(row.total_price)
  };
}

function formatAddress(row) {
  if (!row) return null;
  return {
    fullName: row.full_name,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 || null,
    landmark: row.landmark || null,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country
  };
}

function formatOrder(row, items = [], address = null) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    userId: row.user_id,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    shippingAmount: Number(row.shipping_amount),
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    fulfillmentHoldReason: row.fulfillment_hold_reason || null,
    refundedAmount: Number(row.refunded_amount || 0),
    status: row.order_status,
    razorpayOrderId: row.razorpay_order_id || null,
    razorpayPaymentId: row.razorpay_payment_id || null,
    items,
    address,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function enrichOrder(row) {
  const [itemsRes, addrRes] = await Promise.all([
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [row.id]),
    pool.query('SELECT * FROM order_addresses WHERE order_id = $1', [row.id])
  ]);
  return formatOrder(row, itemsRes.rows.map(formatItem), formatAddress(addrRes.rows[0]));
}

const Order = {
  async createCod(userId, { addressId, checkoutToken } = {}) {
    if (checkoutToken != null && !inventory.UUID.test(checkoutToken)) throw inventory.error(400, 'Invalid checkout attempt.');
    const client = await pool.connect();
    let order;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checkout:${userId}`]);
      await inventory.releaseExpiredReservations(client);
      if (checkoutToken) {
        const previous = await client.query("SELECT * FROM orders WHERE user_id = $1 AND checkout_token = $2 AND payment_method = 'cod' FOR UPDATE", [userId, checkoutToken]);
        if (previous.rows[0]) {
          order = previous.rows[0];
        }
      }
      if (!order) {
      const snapshot = await inventory.checkoutSnapshot(client, userId, addressId);
      const pending = await client.query(`SELECT id FROM orders WHERE cart_id = $1 AND inventory_reserved_at IS NOT NULL
        AND inventory_released_at IS NULL AND payment_status = 'pending' FOR UPDATE`, [snapshot.cart.id]);
      if (pending.rows.length) throw inventory.error(409, 'A prepaid checkout for this cart is pending. Retry it or wait for it to expire.');
      await inventory.deduct(client, snapshot.items);
      const subtotal = (snapshot.amount / 100).toFixed(2);
      const codFee = (COD_FEE_PAISE / 100).toFixed(2);
      const total = ((snapshot.amount + COD_FEE_PAISE) / 100).toFixed(2);
      const result = await client.query(`INSERT INTO orders
        (user_id, cart_id, checkout_token, order_number, subtotal, discount_amount, shipping_amount, total_amount,
         payment_method, payment_status, order_status, inventory_deducted_at)
        VALUES ($1,$2,$3,$4,$5,0,$6,$7,'cod','pending','confirmed',NOW()) RETURNING *`,
        [userId, snapshot.cart.id, checkoutToken || null, genOrderNumber(), subtotal, codFee, total]);
      order = result.rows[0];
      await inventory.snapshotAddress(client, order.id, snapshot.address);
      await inventory.snapshotItems(client, order.id, snapshot.items);
      await client.query("UPDATE carts SET status = 'converted', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'active'", [snapshot.cart.id, userId]);
      await Shipment.enqueue(client, order.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return enrichOrder(order);
  },

  async findByUser(userId, { limit = 100, offset = 0 } = {}) {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset]
    );
    return Promise.all(rows.map(enrichOrder));
  },

  async findAll({ limit = 100, offset = 0 } = {}) {
    const { rows } = await pool.query(`SELECT o.*, json_build_object(
      'shiprocketOrderId', s.shiprocket_order_id,
      'shiprocketShipmentId', s.shiprocket_shipment_id,
      'shippingStatus', COALESCE(s.shipping_status, 'not_created'),
      'awbCode', COALESCE(s.awb_code, o.awb_number),
      'courierName', COALESCE(s.courier_name, o.courier_name),
      'pickupStatus', COALESCE(s.pickup_status, 'pending'),
      'lastErrorCode', COALESCE(s.last_error_code, o.fulfillment_hold_reason)
    ) AS shipment FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.id ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    return Promise.all(rows.map(async row => ({ ...await enrichOrder(row), shipment: row.shipment })));
  },

  async findByIdAndUpdateStatus(id, status) {
    const VALID = ['placed','confirmed','processing','shipped','delivered','cancelled','return_requested','returned'];
    if (!VALID.includes(status)) return null;
    const client = await pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (found.rows[0]) {
        validateTransition(found.rows[0], status);
        if (status === 'shipped' && found.rows[0].order_status !== status) {
          const shipment = await client.query("SELECT order_id FROM shipments WHERE order_id = $1 AND awb_code IS NOT NULL AND pickup_status = 'scheduled'", [id]);
          if (!shipment.rows.length) throw inventory.error(409, 'A courier, AWB and scheduled pickup are required before marking an order shipped.');
        }
        if (['return_requested','returned'].includes(status) && found.rows[0].order_status !== status) {
          const request = await client.query("SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected','cancelled')", [id]);
          if (!request.rows.length) throw inventory.error(409, 'An eligible return request is required for this status change.');
        }
        if (status === 'cancelled') await inventory.releaseReservation(client, found.rows[0]);
        const result = await client.query(`UPDATE orders SET order_status = $1,
          fulfillment_hold_reason = CASE WHEN $1 = 'cancelled' THEN COALESCE(fulfillment_hold_reason, 'ORDER_CANCELLED_REVIEW')
            ELSE fulfillment_hold_reason END,
          shipped_at = CASE WHEN $1 = 'shipped' THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
          delivered_at = CASE WHEN $1 = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
          updated_at = NOW() WHERE id = $2 RETURNING *`, [status, id]);
        updated = result.rows[0];
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    return updated ? enrichOrder(updated) : null;
  },

  async deleteMany() {
    await pool.query('DELETE FROM orders');
  }
};

module.exports = Order;
