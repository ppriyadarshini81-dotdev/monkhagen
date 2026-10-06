const { pool } = require('../config/db');
const Shipment = require('../models/Shipment');
const { shiprocket, shippingError } = require('../config/shiprocket');
const inventory = require('./inventoryService');
const ledger = require('./financialLedgerService');
const { getRazorpay } = require('../config/razorpay');

const ID = /^[0-9a-f-]{36}$/i;
const nonCancellable = value => /shipped|dispatch|picked.?up|in.?transit|out for delivery|delivered|handover|rto|returned/.test(String(value || '').toLowerCase());
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
function fmt(row) { return { eligible: row.status === 'cancelled', status: row.status, reason: row.reason || null,
  cancelledAt: row.cancelled_at || null, refundStatus: row.refund_status, refundId: row.razorpay_refund_id || null,
  shiprocketStatus: row.shiprocket_status }; }
function eligible(order, shipment, cancellation) {
  if (cancellation?.status === 'cancelled') return { eligible: false, reason: 'ALREADY_CANCELLED', message: 'This order has already been cancelled.' };
  if (cancellation?.status) return { eligible: false, reason: 'CANCELLATION_IN_PROGRESS', message: 'Cancellation is already being confirmed.' };
  if (!order || order.order_status === 'cancelled') return { eligible: false, reason: 'ALREADY_CANCELLED', message: 'This order has already been cancelled.' };
  if (nonCancellable(order.order_status) || nonCancellable(order.shipped_at) || nonCancellable(shipment?.shipping_status) || nonCancellable(shipment?.tracking_status) || shipment?.pickup_status === 'picked_up')
    return { eligible: false, reason: 'SHIPMENT_HANDED_OVER', message: 'This order has already been handed to the courier and cannot be cancelled.' };
  if (shipment?.pending_operation) return { eligible: false, reason: 'SHIPPING_IN_PROGRESS', message: 'Shipment processing is in progress. Please try again shortly.' };
  return { eligible: true, reason: null, message: null };
}
async function state(client, orderId, userId) {
  const result = await client.query(`SELECT o.*, s.shiprocket_order_id, s.shiprocket_shipment_id, s.shipping_status, s.tracking_status, s.pickup_status, s.pending_operation,
    c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason, c.cancelled_at, c.refund_status, c.razorpay_refund_id, c.shiprocket_status
    FROM orders o LEFT JOIN shipments s ON s.order_id=o.id LEFT JOIN order_cancellations c ON c.order_id=o.id
    WHERE o.id=$1 AND o.user_id=$2 FOR UPDATE OF o`, [orderId, userId]);
  return result.rows[0] || null;
}
function cancellationFrom(row) { return row?.cancellation_id ? { status: row.cancellation_status, reason: row.cancellation_reason, cancelled_at: row.cancelled_at, refund_status: row.refund_status, razorpay_refund_id: row.razorpay_refund_id, shiprocket_status: row.shiprocket_status } : null; }
function createOrderCancellationService({ database = pool, api = shiprocket, razorpayFactory = getRazorpay, notifications = require('./transactionalEmailService') } = {}) {
  async function getEligibility(userId, orderId) {
    if (!ID.test(orderId || '')) throw fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const client = await database.connect(); try { await client.query('BEGIN'); const row = await state(client, orderId, userId); await client.query('COMMIT');
      if (!row) throw fail(404, 'ORDER_NOT_FOUND', 'Order not found.'); return { orderId, ...eligible(row, row, cancellationFrom(row)), cancellation: cancellationFrom(row) ? fmt(cancellationFrom(row)) : null };
    } catch (e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
  }
  async function cancel(userId, orderId, reason = null) {
    if (!ID.test(orderId || '')) throw fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
    reason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
    return Shipment.withLock(orderId, async lockClient => {
      let row; await lockClient.query('BEGIN');
      try { row = await state(lockClient, orderId, userId); if (!row) throw fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
        const existing = cancellationFrom(row); if (existing?.status === 'cancelled') { await lockClient.query('COMMIT'); return fmt(existing); }
        const check = eligible(row, row, existing); if (!check.eligible) throw fail(409, check.reason, check.message);
        const remote = Number.isSafeInteger(Number(row.shiprocket_order_id));
        await lockClient.query(`INSERT INTO order_cancellations (order_id,cancelled_by,reason,status,shiprocket_status,shiprocket_order_id,refund_status)
          VALUES ($1,$2,$3,'cancelling',$4,$5,$6)`, [orderId,userId,reason,remote?'pending':'not_required',remote?Number(row.shiprocket_order_id):null,
          row.payment_method === 'razorpay' && row.payment_status === 'paid' ? 'pending' : 'not_applicable']);
        await lockClient.query('COMMIT');
      } catch(e) { await lockClient.query('ROLLBACK').catch(()=>{}); throw e; }
      if (Number.isSafeInteger(Number(row.shiprocket_order_id))) {
        try { await api.request('/orders/cancel', { method:'POST', body:{ ids:[Number(row.shiprocket_order_id)] }, acceptEmptyResponse:true });
        } catch(e) { const uncertain = Boolean(e.uncertain); await database.query(`UPDATE order_cancellations SET status=$2, shiprocket_status=$3,last_error_code=$4,updated_at=NOW() WHERE order_id=$1`,
          [orderId, uncertain?'reconciliation_required':'cancelling', uncertain?'reconciliation_required':'failed', e.code || 'SHIPROCKET_CANCELLATION_FAILED']);
          throw fail(409, uncertain?'CANCELLATION_RECONCILIATION_REQUIRED':'SHIPROCKET_CANCELLATION_FAILED', uncertain?'Cancellation needs reconciliation with Shiprocket.':'Shiprocket did not cancel this order; no local cancellation was made.'); }
      }
      const client = await database.connect(); let cancelled;
      try { await client.query('BEGIN'); const current = await state(client, orderId, userId); const currentCancel = cancellationFrom(current);
        // Recheck after the remote operation. A webhook/admin transition wins over this request.
        const check = eligible(current, current, currentCancel); if (current?.order_status !== 'cancelled' && (nonCancellable(current?.order_status) || nonCancellable(current?.shipping_status) || nonCancellable(current?.tracking_status))) throw fail(409,'SHIPMENT_HANDED_OVER','The order was handed to the courier before cancellation completed.');
        await inventory.releaseReservation(client, current);
        const updated = await client.query(`UPDATE orders SET order_status='cancelled', fulfillment_hold_reason='CUSTOMER_CANCELLED', updated_at=NOW() WHERE id=$1 RETURNING *`, [orderId]);
        if (updated.rows[0].payment_method === 'cod') await ledger.codCancelled(client, updated.rows[0]);
        await client.query(`UPDATE order_cancellations SET status='cancelled', cancelled_at=NOW(), shiprocket_status=CASE WHEN shiprocket_status='pending' THEN 'cancelled' ELSE shiprocket_status END, shiprocket_cancelled_at=CASE WHEN shiprocket_status='pending' THEN NOW() ELSE shiprocket_cancelled_at END,updated_at=NOW() WHERE order_id=$1`, [orderId]);
        const result = await client.query('SELECT * FROM order_cancellations WHERE order_id=$1', [orderId]); cancelled=result.rows[0]; await client.query('COMMIT');
      } catch(e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
      if (cancelled.refund_status === 'pending') {
        try { const { razorpay } = razorpayFactory(); const refund = await razorpay.payments.refund(row.razorpay_payment_id, { amount: Math.round(Number(row.total_amount)*100), speed:'normal', notes:{ order_cancellation_id: cancelled.id, order_id: orderId }, receipt:`CANCEL-${String(row.order_number).slice(0,35)}` });
          if (!refund?.id) throw fail(502,'REFUND_INVALID_RESPONSE','Refund provider did not confirm the refund.');
          const rc=await database.connect(); try { await rc.query('BEGIN'); await rc.query(`UPDATE order_cancellations SET refund_status='processing',razorpay_refund_id=$2,refund_initiated_at=NOW(),updated_at=NOW() WHERE order_id=$1`,[orderId,refund.id]); await ledger.refund(rc,{orderId,refundId:refund.id,amount:row.total_amount,status:'PENDING',eventType:'ORDER_CANCELLATION_REFUND_INITIATED'}); await rc.query('COMMIT'); } catch(e){await rc.query('ROLLBACK').catch(()=>{});throw e;} finally{rc.release();}
        } catch(e) { await database.query(`UPDATE order_cancellations SET refund_status='reconciliation_required',last_error_code='REFUND_RECONCILIATION_REQUIRED',updated_at=NOW() WHERE order_id=$1`,[orderId]); }
      }
      const result = await database.query('SELECT * FROM order_cancellations WHERE order_id=$1',[orderId]);
      if (notifications?.orderCancelled) await notifications.orderCancelled(orderId).catch(()=>{});
      return fmt(result.rows[0]);
    });
  }
  return { getEligibility, cancel, eligible };
}
module.exports = { ...createOrderCancellationService(), createOrderCancellationService, nonCancellable };
