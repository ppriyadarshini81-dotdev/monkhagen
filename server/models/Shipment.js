const { pool } = require('../config/db');
const { shippingError } = require('../config/shiprocket');
const { randomUUID } = require('node:crypto');

async function assertLease(client) {
  if (!client.shipmentLease) return;
  const lease = client.shipmentLease;
  const result = await client.query(`SELECT 1 FROM operation_leases
    WHERE lock_key = $1 AND owner_token = $2 AND expires_at > clock_timestamp() FOR UPDATE`, [lease.key, lease.token]);
  if (!result.rows.length) throw shippingError(409, 'SHIPPING_BUSY', 'Shipping operation ownership changed. Review before retrying.');
}

const COLUMNS = new Set([
  'shiprocket_order_id', 'shiprocket_shipment_id', 'awb_code', 'courier_id', 'courier_name',
  'shipping_status', 'tracking_status', 'tracking_url', 'label_url', 'shipping_charge',
  'estimated_delivery', 'pickup_status', 'pickup_scheduled_date', 'pickup_location',
  'package_weight', 'package_length', 'package_breadth', 'package_height', 'pending_operation',
  'operation_started_at', 'last_error_code', 'attempt_count', 'next_attempt_at',
  'tracking_events', 'tracking_checked_at'
]);

function format(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    shiprocketOrderId: row.shiprocket_order_id,
    shiprocketShipmentId: row.shiprocket_shipment_id,
    awbCode: row.awb_code,
    courierId: row.courier_id,
    courierName: row.courier_name,
    shippingStatus: row.shipping_status,
    trackingStatus: row.tracking_status,
    trackingUrl: row.tracking_url,
    labelUrl: row.label_url,
    shippingCharge: row.shipping_charge == null ? null : Number(row.shipping_charge),
    estimatedDelivery: row.estimated_delivery,
    pickupStatus: row.pickup_status,
    pickupScheduledDate: row.pickup_scheduled_date,
    pendingOperation: row.pending_operation,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const Shipment = {
  format,

  // Called inside the payment transaction: either payment + work item commit, or neither does.
  async enqueue(client, orderId) {
    await client.query(
      'INSERT INTO shipments (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING', [orderId]
    );
  },

  async find(client, orderId) {
    const { rows } = await client.query('SELECT * FROM shipments WHERE order_id = $1', [orderId]);
    return rows[0] || null;
  },

  async invoiceSource(orderId) {
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number, o.user_id, s.shiprocket_order_id
       FROM orders o
       LEFT JOIN shipments s ON s.order_id = o.id
       WHERE o.id = $1`,
      [orderId]
    );
    return rows[0] || null;
  },

  async order(client, orderId) {
    const { rows } = await client.query(
      `SELECT o.*, u.email AS customer_email FROM orders o
       JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [orderId]
    );
    return rows[0] || null;
  },

  async details(client, orderId) {
    const address = await client.query('SELECT * FROM order_addresses WHERE order_id = $1', [orderId]);
    const items = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at, id', [orderId]);
    return { address: address.rows[0], items: items.rows };
  },

  async patch(client, orderId, changes) {
    const entries = Object.entries(changes);
    if (entries.some(([key]) => !COLUMNS.has(key))) throw new Error('Unsupported shipment field.');
    const values = entries.map(([key, value]) => key === 'tracking_events' ? JSON.stringify(value) : value);
    values.push(orderId);
    const orderParameter = values.length;
    let fence = '';
    if (client.shipmentLease) {
      values.push(client.shipmentLease.key, client.shipmentLease.token);
      fence = `AND EXISTS (SELECT 1 FROM operation_leases WHERE lock_key = $${values.length - 1}
        AND owner_token = $${values.length} AND expires_at > clock_timestamp())`;
    }
    if (['create','awb','pickup','label'].includes(changes.pending_operation)) {
      const statuses = changes.pending_operation === 'label'
        ? "('placed','confirmed','processing','shipped','delivered')" : "('placed','confirmed','processing')";
      fence += ` AND EXISTS (SELECT 1 FROM orders o WHERE o.id = $${orderParameter}
        AND o.fulfillment_hold_reason IS NULL AND o.order_status IN ${statuses}
        AND ((o.payment_method = 'cod' AND o.payment_status IN ('pending','paid'))
          OR (o.payment_method = 'razorpay' AND o.payment_status = 'paid'))) `;
    }
    const { rows } = await client.query(
      `UPDATE shipments SET ${entries.map(([key], index) => `${key} = $${index + 1}`).join(', ')}, updated_at = NOW()
       WHERE order_id = $${orderParameter} ${fence} RETURNING *`, values
    );
    if ((client.shipmentLease || fence) && !rows.length) throw shippingError(409, 'SHIPPING_BUSY', 'Shipping operation ownership or order eligibility changed. Review before retrying.');
    return rows[0];
  },

  async save(client, orderId, changes, delivery = {}) {
    await client.query('BEGIN');
    try {
      await assertLease(client);
      const row = await this.patch(client, orderId, changes);
      // Preserve compatibility with /api/account/orders and /api/account/orders/:id/tracking.
      await client.query(
        `UPDATE orders SET awb_number = COALESCE($1, awb_number),
           courier_name = COALESCE($2, courier_name), tracking_url = COALESCE($3, tracking_url),
           shipped_at = COALESCE(shipped_at, $4::timestamptz),
           delivered_at = COALESCE(delivered_at, $5::timestamptz),
           order_status = CASE
             WHEN $5::timestamptz IS NOT NULL AND order_status IN ('placed','confirmed','processing','shipped') THEN 'delivered'
             WHEN $4::timestamptz IS NOT NULL AND order_status IN ('placed','confirmed','processing') THEN 'shipped'
             ELSE order_status END,
           updated_at = NOW() WHERE id = $6`,
        [row.awb_code, row.courier_name, row.tracking_url, delivery.pickedUpAt || null,
         delivery.deliveredAt || null, orderId]
      );
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  },

  async withLock(orderId, fn) {
    const client = await pool.connect();
    const lease = { key: `shiprocket:${orderId}`, token: randomUUID() };
    let locked = false, heartbeat;
    try {
      const result = await client.query(`INSERT INTO operation_leases (lock_key, owner_token, expires_at)
        VALUES ($1,$2,clock_timestamp() + INTERVAL '5 minutes')
        ON CONFLICT (lock_key) DO UPDATE SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
        WHERE operation_leases.expires_at <= clock_timestamp() RETURNING owner_token`, [lease.key, lease.token]);
      locked = result.rows.length > 0;
      if (!locked) throw shippingError(409, 'SHIPPING_BUSY', 'A shipping operation is already running for this order.');
      client.shipmentLease = lease;
      heartbeat = setInterval(() => {
        void pool.query(`UPDATE operation_leases SET expires_at = clock_timestamp() + INTERVAL '5 minutes'
          WHERE lock_key = $1 AND owner_token = $2 AND expires_at > clock_timestamp()`, [lease.key, lease.token]).catch(() => {});
      }, 30000);
      heartbeat.unref();
      return await fn(client);
    } finally {
      clearInterval(heartbeat);
      if (locked) {
        await client.query('DELETE FROM operation_leases WHERE lock_key = $1 AND owner_token = $2', [lease.key, lease.token]).catch(() => {});
      }
      delete client.shipmentLease;
      client.release();
    }
  },

  async pending(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid queue batch size.');
    const { rows } = await pool.query(
      `SELECT s.order_id FROM shipments s JOIN orders o ON o.id = s.order_id
       WHERE s.shiprocket_order_id IS NULL AND s.pending_operation IS NULL
         AND s.shipping_status IN ('pending','retry_pending') AND o.fulfillment_hold_reason IS NULL
         AND o.order_status IN ('placed','confirmed','processing')
         AND ((o.payment_method = 'razorpay' AND o.payment_status = 'paid')
           OR (o.payment_method = 'cod' AND o.payment_status IN ('pending','paid')))
         AND s.last_error_code IS DISTINCT FROM 'SHIPROCKET_AUTH_FAILED'
         AND s.last_error_code IS DISTINCT FROM 'SHIPROCKET_NOT_CONFIGURED'
         AND s.last_error_code IS DISTINCT FROM 'SHIPROCKET_PERMISSION_DENIED'
         AND s.next_attempt_at <= NOW()
       ORDER BY s.next_attempt_at LIMIT $1`, [limit]
    );
    return rows.map(row => row.order_id);
  }
};

module.exports = Shipment;
