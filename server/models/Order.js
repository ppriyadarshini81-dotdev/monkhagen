const { pool } = require('../config/db');
const Shipment = require('./Shipment');

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
  async create({ userId, items, address, subtotal, discountAmount = 0, shippingAmount = 0, totalAmount, paymentMethod }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderNumber = genOrderNumber();
      const { rows } = await client.query(
        `INSERT INTO orders (user_id, order_number, subtotal, discount_amount, shipping_amount, total_amount, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, orderNumber, subtotal, discountAmount, shippingAmount, totalAmount, paymentMethod || 'cod']
      );
      const order = rows[0];

      await client.query(
        `INSERT INTO order_addresses
           (order_id, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, address.fullName, address.phone, address.addressLine1,
         address.addressLine2 || null, address.landmark || null,
         address.city, address.state, address.postalCode, address.country || 'India']
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items
             (order_id, product_id, variant_id, product_name, sku, size, color, quantity, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [order.id, item.productId, item.variantId, item.productName,
           item.sku || null, item.size || null, item.color || null,
           item.quantity, item.unitPrice, item.totalPrice]
        );
      }

      if (!paymentMethod || paymentMethod === 'cod') await Shipment.enqueue(client, order.id);
      await client.query('COMMIT');
      return enrichOrder(order);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async findByUser(userId) {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [userId]
    );
    return Promise.all(rows.map(enrichOrder));
  },

  async findAll() {
    const { rows } = await pool.query(`SELECT o.*, json_build_object(
      'shiprocketOrderId', s.shiprocket_order_id,
      'shiprocketShipmentId', s.shiprocket_shipment_id,
      'shippingStatus', COALESCE(s.shipping_status, 'not_created'),
      'awbCode', COALESCE(s.awb_code, o.awb_number),
      'courierName', COALESCE(s.courier_name, o.courier_name),
      'pickupStatus', COALESCE(s.pickup_status, 'pending'),
      'lastErrorCode', s.last_error_code
    ) AS shipment FROM orders o
    LEFT JOIN shipments s ON s.order_id = o.id ORDER BY o.created_at DESC`);
    return Promise.all(rows.map(async row => ({ ...await enrichOrder(row), shipment: row.shipment })));
  },

  async findByIdAndUpdateStatus(id, status) {
    const VALID = ['placed','confirmed','processing','shipped','delivered','cancelled','return_requested','returned'];
    if (!VALID.includes(status)) return null;
    const { rows } = await pool.query(
      `UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return rows[0] ? enrichOrder(rows[0]) : null;
  },

  async deleteMany() {
    await pool.query('DELETE FROM orders');
  }
};

module.exports = Order;
