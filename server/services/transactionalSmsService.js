const { pool } = require('../config/db');
const msg91 = require('./msg91SmsService');
const { normalizeIndianMobile } = require('./phoneNumber');

const EVENT_TYPE = 'ORDER_CONFIRMED_SMS';
const SENDER_ID = 'KABAPP';
const MAX_ATTEMPTS = 5;
const ORDER_NUMBER = /^MH-[A-Z0-9-]{5,40}$/;
const CONFIRMED_STATES = new Set(['confirmed', 'processing', 'shipped', 'delivered', 'return_requested', 'returned']);

function safeCode(value, fallback = 'SMS_DELIVERY_FAILED') {
  return typeof value === 'string' && /^[A-Z0-9_]{1,100}$/.test(value) ? value : fallback;
}

function isConfirmed(order) {
  if (!order || !CONFIRMED_STATES.has(order.order_status)) return false;
  if (order.payment_method === 'cod') return ['pending', 'paid'].includes(order.payment_status);
  return order.payment_method === 'razorpay' && order.payment_status === 'paid';
}

function createTransactionalSmsService({ database = pool, provider = msg91, environment = process.env } = {}) {
  async function orderSnapshot(orderId) {
    const { rows } = await database.query(
      `SELECT o.id, o.order_number, o.payment_method, o.payment_status, o.order_status, oa.phone
       FROM orders o LEFT JOIN order_addresses oa ON oa.order_id = o.id
       WHERE o.id = $1`, [orderId]
    );
    return rows[0] || null;
  }

  async function insertOrderConfirmed(order) {
    if (!isConfirmed(order) || !ORDER_NUMBER.test(String(order.order_number || ''))) return [];
    const phone = normalizeIndianMobile(order.phone);
    if (!phone) return [];
    const eventKey = `${EVENT_TYPE}:${order.id}`;
    const { rows } = await database.query(
      `INSERT INTO transactional_sms_events
       (event_key, event_type, order_id, recipient, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [eventKey, EVENT_TYPE, order.id, `91${phone}`, JSON.stringify({ var1: order.order_number })]
    );
    return rows[0] ? [rows[0].event_key] : [];
  }

  async function claim(eventKeys = null) {
    const params = [MAX_ATTEMPTS];
    let keys = '';
    if (Array.isArray(eventKeys) && eventKeys.length) {
      params.push(eventKeys);
      keys = `AND event_key = ANY($${params.length}::varchar[])`;
    }
    const { rows } = await database.query(
      `UPDATE transactional_sms_events SET status = 'sending', attempt_count = attempt_count + 1,
         updated_at = NOW()
       WHERE id = (SELECT id FROM transactional_sms_events
         WHERE status IN ('pending','failed') AND attempt_count < $1 AND next_attempt_at <= NOW() ${keys}
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *`, params
    );
    return rows[0] || null;
  }

  async function deliver(event) {
    const templateId = environment.MSG91_ORDER_CONFIRMED_TEMPLATE_ID?.trim();
    const orderNumber = event.metadata?.var1;
    if (!ORDER_NUMBER.test(String(orderNumber || '')) || !/^91[6-9]\d{9}$/.test(event.recipient || '')) {
      await database.query(`UPDATE transactional_sms_events SET status = 'skipped', last_error = 'SMS_EVENT_INVALID',
        updated_at = NOW() WHERE id = $1`, [event.id]);
      return 'skipped';
    }
    const providerMessageId = await provider.sendTemplate({
      mobile: event.recipient,
      templateId,
      senderId: SENDER_ID,
      variables: { var1: orderNumber }
    });
    await database.query(`UPDATE transactional_sms_events SET status = 'sent', provider_message_id = $2,
      sent_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`, [event.id, providerMessageId]);
    return 'sent';
  }

  async function processPendingSms({ limit = 20, eventKeys = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid SMS queue batch size.');
    await database.query(`UPDATE transactional_sms_events SET status = 'failed', last_error = 'SMS_SEND_INTERRUPTED',
      next_attempt_at = NOW(), updated_at = NOW()
      WHERE status = 'sending' AND updated_at < NOW() - INTERVAL '15 minutes'`);
    const result = { sent: 0, failed: 0, skipped: 0 };
    for (let index = 0; index < limit; index += 1) {
      const event = await claim(eventKeys);
      if (!event) break;
      try {
        result[await deliver(event)] += 1;
      } catch (error) {
        result.failed += 1;
        const delayMinutes = Math.min(360, 5 * (2 ** Math.max(0, Number(event.attempt_count) - 1)));
        await database.query(`UPDATE transactional_sms_events SET status = 'failed', last_error = $2,
          next_attempt_at = NOW() + ($3::text || ' minutes')::interval, updated_at = NOW() WHERE id = $1`,
        [event.id, safeCode(error.code), String(delayMinutes)]).catch(() => {});
        if (Number(event.attempt_count) >= MAX_ATTEMPTS) {
          console.error('Transactional SMS exhausted its retry limit.', { eventType: event.event_type, code: safeCode(error.code) });
        }
      }
    }
    return result;
  }

  async function orderConfirmed(orderId) {
    try {
      const order = await orderSnapshot(orderId);
      const keys = order ? await insertOrderConfirmed(order) : [];
      return keys.length ? processPendingSms({ limit: keys.length, eventKeys: keys }) : { sent: 0, failed: 0, skipped: 0 };
    } catch (error) {
      console.error('Transactional SMS event could not be queued.', { code: safeCode(error.code, 'SMS_QUEUE_FAILED') });
      return { sent: 0, failed: 1, skipped: 0 };
    }
  }

  return { orderConfirmed, processPendingSms, _isConfirmed: isConfirmed };
}

const service = createTransactionalSmsService();
module.exports = { ...service, createTransactionalSmsService, EVENT_TYPE, SENDER_ID, isConfirmed };
