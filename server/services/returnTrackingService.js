const { pool } = require('../config/db');
const { shiprocket, shippingError } = require('../config/shiprocket');
const { normalizeTracking } = require('./shippingMapping');

const CLOSED = new Set(['received', 'approved', 'refund_initiated', 'refunded', 'rejected', 'cancelled']);
const RANK = { requested: 0, return_created: 1, pickup_scheduled: 2, picked_up: 3, in_transit: 4, received: 5 };

function providerDate(value) {
  if (typeof value !== 'string' || !value || value.startsWith('0000')) return null;
  const text = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + '+05:30' : value;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function createReturnTrackingService({ database = pool, api = shiprocket, now = Date.now,
  mapStatus = payload => require('./returnService').mappedWebhookStatus(payload),
  forwardTracking = (id, user) => require('./shippingService').tracking(id, user) } = {}) {
  const checks = new Map();

  async function refreshReverse(row) {
    const remoteId = Number(row.shiprocket_return_order_id);
    const response = await api.request(`/orders/show/${remoteId}`);
    const remote = response?.data;
    const shipments = Array.isArray(remote?.shipments) ? remote.shipments : remote?.shipments ? [remote.shipments] : [];
    const shipment = shipments[0];
    if (Number(remote?.id) !== remoteId || remote?.channel_order_id !== row.return_number || shipments.length !== 1 ||
        !Number.isSafeInteger(Number(shipment?.id)) || Number(shipment.id) <= 0 ||
        (row.shiprocket_return_shipment_id && Number(shipment.id) !== Number(row.shiprocket_return_shipment_id))) {
      throw shippingError(409, 'SHIPMENT_MISMATCH', 'Shiprocket did not confirm the linked return shipment.');
    }
    const awb = shipment.awb || shipment.awb_code || row.return_awb || null;
    if (row.return_awb && awb && String(row.return_awb) !== String(awb)) {
      throw shippingError(409, 'SHIPMENT_MISMATCH', 'The return AWB does not match Shiprocket.');
    }
    let label = typeof remote.status === 'string' ? remote.status : '';
    let next = mapStatus({ status: remote.status, status_code: remote.status_code });
    let receivedAt = null;
    if (awb) {
      const raw = await api.request(`/courier/track/awb/${encodeURIComponent(awb)}`);
      const track = raw?.tracking_data?.shipment_track?.[0];
      if ((track?.awb_code && String(track.awb_code) !== String(awb)) ||
          (track?.shipment_id && Number(track.shipment_id) !== Number(shipment.id))) {
        throw shippingError(409, 'SHIPMENT_MISMATCH', 'Tracking does not match the linked return shipment.');
      }
      const tracking = normalizeTracking(raw);
      if (tracking.available) {
        next = mapStatus({ shipment_status: tracking.status, shipment_status_id: tracking.statusCode }) || next;
        label = tracking.status || label;
        receivedAt = next === 'received' ? providerDate(tracking.deliveredAt) : null;
      }
    }
    if (!next) return;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const { rows: [current] } = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [row.id]);
      // Recheck after the remote request: inspection/refunds and concurrent local
      // operations must never be undone by an old tracking response.
      if (!current || CLOSED.has(current.status) || current.inventory_restored_at ||
          Number(current.shiprocket_return_order_id) !== remoteId ||
          (current.shiprocket_return_shipment_id && Number(current.shiprocket_return_shipment_id) !== Number(shipment.id)) ||
          (current.pending_operation && current.pending_operation !== 'cancel') ||
          (current.return_awb && awb && String(current.return_awb) !== String(awb))) {
        await client.query('COMMIT'); return;
      }
      const advances = next === 'cancelled' || next === 'pickup_failed' ||
        (RANK[next] != null && RANK[next] >= (RANK[current.status] ?? -1));
      if (advances) {
        await client.query(`UPDATE return_requests SET status = $1::text, provider_status = $2, pickup_status = $6,
          return_awb = COALESCE(return_awb, $3),
          received_at = CASE WHEN $1::text = 'received' THEN COALESCE(received_at, $4::timestamptz, NOW()) ELSE received_at END,
          pending_operation = CASE WHEN $1::text = 'cancelled' AND pending_operation = 'cancel' THEN NULL ELSE pending_operation END,
          operation_started_at = CASE WHEN $1::text = 'cancelled' AND pending_operation = 'cancel' THEN NULL ELSE operation_started_at END,
          updated_at = NOW() WHERE id = $5`, [next, String(label).slice(0, 100), awb ? String(awb) : null, receivedAt, row.id, String(label).slice(0, 50)]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }

  async function refresh(row, user) {
    if (!row || !user || (row.user_id !== user.id && !['admin', 'super_admin'].includes(user.role))) {
      throw shippingError(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    }
    const reverse = Number.isSafeInteger(Number(row.shiprocket_return_order_id)) && Number(row.shiprocket_return_order_id) > 0 && !CLOSED.has(row.status) &&
      (!row.pending_operation || row.pending_operation === 'cancel');
    const outbound = row.outbound_order;
    const forward = outbound?.shiprocketOrderId && !['delivered', 'cancelled', 'returned'].includes(outbound.status);
    if (!reverse && !forward) return { unavailable: false, checked: false };
    const key = `${row.id}:${row.shiprocket_return_order_id}:${row.pending_operation || ''}:${outbound?.id || ''}:${outbound?.shiprocketOrderId || ''}`;
    const previous = checks.get(key);
    if (previous && (previous.pending || now() - previous.checkedAt < 60000)) return previous.pending || previous.result;
    const record = {};
    // Coalesce concurrent tab loads and bound this process-local cache. No schema changes.
    if (checks.size >= 1000) checks.delete(checks.keys().next().value);
    checks.set(key, record);
    record.pending = (async () => {
      let unavailable = false;
      if (reverse) {
        try { await refreshReverse(row); } catch (error) {
          unavailable = true;
          console.error('Return tracking refresh failed:', { returnId: row.id, phase: 'reverse',
            code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'RETURN_TRACKING_UNAVAILABLE' });
        }
      }
      if (forward) {
        try { await forwardTracking(outbound.id, user); } catch (error) {
          unavailable = true;
          console.error('Return tracking refresh failed:', { returnId: row.id, phase: 'outbound',
            code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'RETURN_TRACKING_UNAVAILABLE' });
        }
      }
      record.checkedAt = now();
      record.result = { unavailable, checked: true };
      record.pending = null;
      return record.result;
    })();
    return record.pending;
  }
  return { refresh };
}

module.exports = { createReturnTrackingService, ...createReturnTrackingService() };
