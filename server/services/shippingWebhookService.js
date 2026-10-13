const crypto = require('node:crypto');
const { pool } = require('../config/db');
const emails = require('./transactionalEmailService');
const { safeUrl } = require('./shippingMapping');

const SHIPMENT_CODES = new Map([
  [6, 'shipped'], [18, 'shipped'], [42, 'shipped'],
  [17, 'out_for_delivery'],
  [7, 'delivered'],
  [8, 'cancelled'], [12, 'failed'], [13, 'failed'], [16, 'cancelled'], [20, 'failed'], [21, 'failed'], [24, 'failed'], [25, 'failed']
]);
const NO_EMAILS = { orderShipped: async () => {}, orderOutForDelivery: async () => {}, orderDelivered: async () => {} };

function fault(status, code, message) { return Object.assign(new Error(message), { status, code }); }
async function notifySafely(action) {
  try { await action(); }
  catch (error) { console.error('Tracking notification could not be queued.', { code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'EMAIL_QUEUE_FAILED' }); }
}

function secureEqual(expected, received) {
  if (typeof expected !== 'string' || !expected || typeof received !== 'string') return false;
  const a = Buffer.from(expected); const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function numeric(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function statusLabel(payload) {
  return String(payload.shipment_status ?? payload.current_status ?? payload.status_label ??
    payload['sr-status-label'] ?? payload.sr_status_label ?? '').trim().slice(0, 255);
}

function mappedForwardStatus(payload) {
  const label = statusLabel(payload).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/return|rto/.test(label)) {
    if (/awb assigned/.test(label)) return 'awb_assigned';
    if (/pickup scheduled|pickup generated|out for pickup/.test(label)) return 'pickup_scheduled';
  }
  if (/^delivered$|shipment delivered/.test(label) && !/return|rto/.test(label)) return 'delivered';
  if (/out for delivery/.test(label) && !/return|rto/.test(label)) return 'out_for_delivery';
  if (/^picked up$|^shipped$|^in transit$|shipment picked up|shipment in transit/.test(label) && !/return|rto/.test(label)) return 'shipped';
  if (/cancell?ed|cancellation requested/.test(label)) return 'cancelled';
  if (/lost|damaged|pickup (error|exception)|undelivered/.test(label)) return 'failed';
  for (const value of [payload.shipment_status_id, payload.current_status_id, payload.sr_status, payload['sr-status']]) {
    const code = numeric(value);
    if (code != null && SHIPMENT_CODES.has(code)) return SHIPMENT_CODES.get(code);
  }
  return null;
}

async function processForwardWebhook(payload, headers, database = pool, environment = process.env, notifications = null) {
  const notifier = notifications || (database === pool ? emails : NO_EMAILS);
  if (!secureEqual(environment.SHIPROCKET_WEBHOOK_SECRET, headers['x-api-key'])) {
    throw fault(401, 'WEBHOOK_UNAUTHORIZED', 'Invalid webhook token.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fault(400, 'WEBHOOK_INVALID', 'Invalid webhook body.');
  const next = mappedForwardStatus(payload);
  const awb = payload.awb ?? payload.awb_code;
  const normalizedAwb = awb == null ? null : String(awb).slice(0, 100);
  const providerOrderId = numeric(payload.sr_order_id);
  const channelOrderId = typeof payload.order_id === 'string' ? payload.order_id.slice(0, 100) : null;
  if (!next || (!normalizedAwb && providerOrderId == null && !channelOrderId)) return { ignored: true, duplicate: false };

  const client = await database.connect();
  let orderId = null;
  let notify = null;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT s.*, o.order_status, o.order_type FROM shipments s JOIN orders o ON o.id = s.order_id
       WHERE ($1::text IS NOT NULL AND s.awb_code = $1)
          OR ($2::bigint IS NOT NULL AND s.shiprocket_order_id = $2)
          OR ($3::text IS NOT NULL AND (o.id::text = $3 OR o.order_number = $3))
       FOR UPDATE OF s, o`, [normalizedAwb, providerOrderId, channelOrderId]
    );
    const row = found.rows[0];
    if (!row) { await client.query('COMMIT'); return { ignored: true, duplicate: false }; }
    orderId = row.order_id;
    const eventId = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const claim = await client.query(
      'INSERT INTO shipment_webhook_events (event_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',
      [eventId, orderId]
    );
    if (!claim.rows.length) { await client.query('COMMIT'); return { ignored: false, duplicate: true }; }

    const providerLabel = statusLabel(payload);
    const trackingUrl = safeUrl(payload.tracking_url ?? payload.track_url);
    const courierName = typeof (payload.courier_name ?? payload.courier) === 'string'
      ? String(payload.courier_name ?? payload.courier).trim().slice(0, 255) : null;
    const estimated = typeof (payload.etd ?? payload.edd) === 'string' ? String(payload.etd ?? payload.edd).slice(0, 100) : null;
    await client.query(
      `UPDATE shipments SET awb_code = COALESCE(awb_code, $2), courier_name = COALESCE($3, courier_name),
       tracking_status = COALESCE(NULLIF($4, ''), tracking_status), tracking_url = COALESCE($5, tracking_url),
       estimated_delivery = COALESCE($6, estimated_delivery), shipping_status = CASE
         WHEN shipping_status = 'delivered' THEN shipping_status
         WHEN shipping_status = 'out_for_delivery' AND $7 IN ('awb_assigned','pickup_scheduled','shipped') THEN shipping_status
         WHEN shipping_status = 'shipped' AND $7 IN ('awb_assigned','pickup_scheduled') THEN shipping_status
         ELSE $7 END,
       pickup_status = CASE WHEN $7 = 'pickup_scheduled' THEN 'scheduled' ELSE pickup_status END,
       tracking_checked_at = NOW(), updated_at = NOW() WHERE order_id = $1`,
      [orderId, normalizedAwb, courierName, providerLabel, trackingUrl, estimated, next]
    );

    const terminal = ['delivered','cancelled','returned'].includes(row.order_status);
    if (next === 'delivered' && row.order_status !== 'delivered' && !['cancelled','returned'].includes(row.order_status)) {
      await client.query(`UPDATE orders SET order_status = 'delivered', shipped_at = COALESCE(shipped_at, NOW()),
        delivered_at = COALESCE(delivered_at, NOW()), awb_number = COALESCE(awb_number, $2),
        courier_name = COALESCE($3, courier_name), tracking_url = COALESCE($4, tracking_url), updated_at = NOW() WHERE id = $1`,
      [orderId, normalizedAwb, courierName, trackingUrl]);
      notify = 'delivered';
    } else if (next === 'out_for_delivery' && !terminal) {
      await client.query(`UPDATE orders SET order_status = CASE WHEN order_status IN ('placed','confirmed','processing') THEN 'shipped' ELSE order_status END,
        shipped_at = COALESCE(shipped_at, NOW()), awb_number = COALESCE(awb_number, $2), courier_name = COALESCE($3, courier_name),
        tracking_url = COALESCE($4, tracking_url), updated_at = NOW() WHERE id = $1`, [orderId, normalizedAwb, courierName, trackingUrl]);
      if (row.shipping_status !== 'out_for_delivery') notify = 'out_for_delivery';
    } else if (next === 'shipped' && !terminal) {
      await client.query(`UPDATE orders SET order_status = CASE WHEN order_status IN ('placed','confirmed','processing') THEN 'shipped' ELSE order_status END,
        shipped_at = COALESCE(shipped_at, NOW()), awb_number = COALESCE(awb_number, $2), courier_name = COALESCE($3, courier_name),
        tracking_url = COALESCE($4, tracking_url), updated_at = NOW() WHERE id = $1`, [orderId, normalizedAwb, courierName, trackingUrl]);
      if (row.order_status !== 'shipped') notify = 'shipped';
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }

  if (notify === 'shipped') await notifySafely(() => notifier.orderShipped(orderId));
  if (notify === 'out_for_delivery') await notifySafely(() => notifier.orderOutForDelivery(orderId));
  if (notify === 'delivered') await notifySafely(() => notifier.orderDelivered(orderId));
  return { ignored: false, duplicate: false };
}

module.exports = { SHIPMENT_CODES, mappedForwardStatus, processForwardWebhook };
