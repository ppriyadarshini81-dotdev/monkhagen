const { pool } = require('../config/db');
const { getTransporter } = require('../config/mailer');
const { buildEmail } = require('./transactionalEmailTemplates');

const EMAIL = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const MAX_ATTEMPTS = 5;
const CUSTOMER_EVENTS = new Set([
  'ORDER_CONFIRMED_CUSTOMER', 'ORDER_SHIPPED_CUSTOMER', 'ORDER_OUT_FOR_DELIVERY_CUSTOMER', 'ORDER_DELIVERED_CUSTOMER',
  'RETURN_REQUESTED_CUSTOMER', 'RETURN_PICKUP_SCHEDULED_CUSTOMER', 'RETURN_PICKED_UP_CUSTOMER',
  'RETURN_RECEIVED_CUSTOMER', 'RETURN_APPROVED_CUSTOMER', 'REFUND_INITIATED_CUSTOMER', 'REFUND_COMPLETED_CUSTOMER',
  'COD_REFUND_PENDING_CUSTOMER'
]);

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

function adminEmail(environment = process.env) {
  return normalizedEmail(environment.CONTACT_EMAIL) || 'official@monkhagen.in';
}

function safeCode(value, fallback = 'EMAIL_DELIVERY_FAILED') {
  return typeof value === 'string' && /^[A-Z0-9_]{1,100}$/.test(value) ? value : fallback;
}

function safeSubject(value) { return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200); }

function createTransactionalEmailService({ database = pool, mailer = getTransporter, environment = process.env } = {}) {
  async function orderRecipient(orderId) {
    const { rows } = await database.query(`SELECT COALESCE(NULLIF(oa.email, ''), u.email) AS email
      FROM orders o JOIN users u ON u.id = o.user_id
      LEFT JOIN order_addresses oa ON oa.order_id = o.id WHERE o.id = $1`, [orderId]);
    return normalizedEmail(rows[0]?.email);
  }

  async function returnRecipient(returnId) {
    const { rows } = await database.query(`SELECT COALESCE(NULLIF(oa.email, ''), u.email) AS email
      FROM return_requests rr JOIN users u ON u.id = rr.user_id
      JOIN orders o ON o.id = rr.order_id
      LEFT JOIN order_addresses oa ON oa.order_id = o.id WHERE rr.id = $1`, [returnId]);
    return normalizedEmail(rows[0]?.email);
  }

  async function insert(event) {
    const recipient = normalizedEmail(event.recipient);
    if (!recipient) return null;
    const { rows } = await database.query(
      `INSERT INTO transactional_email_events
       (event_key, event_type, order_id, return_id, recipient, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [event.eventKey, event.eventType, event.orderId || null, event.returnId || null, recipient,
        JSON.stringify(event.metadata || {})]
    );
    return rows[0]?.event_key || null;
  }

  async function queueOrder(orderId, types, metadata = {}, keyReference = '') {
    const customer = types.filter(type => CUSTOMER_EVENTS.has(type)).length ? await orderRecipient(orderId) : null;
    const keys = [];
    for (const type of types) {
      const recipient = CUSTOMER_EVENTS.has(type) ? customer : adminEmail(environment);
      const eventKey = `${type}:${orderId}${keyReference ? `:${keyReference}` : ''}`;
      const inserted = await insert({ eventKey, eventType: type, orderId, recipient, metadata });
      if (inserted) keys.push(inserted);
    }
    return keys;
  }

  async function queueReturn(returnId, types, metadata = {}, keyReference = '') {
    const customer = types.filter(type => CUSTOMER_EVENTS.has(type)).length ? await returnRecipient(returnId) : null;
    const keys = [];
    for (const type of types) {
      const recipient = CUSTOMER_EVENTS.has(type) ? customer : adminEmail(environment);
      const eventKey = `${type}:${returnId}${keyReference ? `:${keyReference}` : ''}`;
      const inserted = await insert({ eventKey, eventType: type, returnId, recipient, metadata });
      if (inserted) keys.push(inserted);
    }
    return keys;
  }

  async function loadOrder(orderId) {
    const { rows } = await database.query(
      `SELECT o.*, u.name AS customer_name, COALESCE(NULLIF(oa.email, ''), u.email) AS customer_email, u.phone AS customer_phone,
        oa.full_name, oa.phone, oa.email AS delivery_email, oa.address_line1, oa.address_line2, oa.landmark, oa.city, oa.state, oa.postal_code, oa.country,
        s.shiprocket_order_id, s.awb_code, s.courier_name, s.shipping_status, s.tracking_status,
        s.tracking_url, s.estimated_delivery
       FROM orders o JOIN users u ON u.id = o.user_id
       LEFT JOIN order_addresses oa ON oa.order_id = o.id
       LEFT JOIN shipments s ON s.order_id = o.id WHERE o.id = $1`, [orderId]
    );
    if (!rows[0]) return null;
    const order = rows[0];
    const items = await database.query(
      `SELECT oi.*, p.slug AS product_slug,
        (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = oi.product_id
         ORDER BY pi.is_primary DESC, pi.display_order, pi.id LIMIT 1) AS image_url
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1 ORDER BY oi.created_at, oi.id`, [orderId]
    );
    order.items = items.rows;
    order.address = {
      full_name: order.full_name, phone: order.phone, address_line1: order.address_line1, address_line2: order.address_line2,
      landmark: order.landmark, city: order.city, state: order.state, postal_code: order.postal_code, country: order.country
    };
    return order;
  }

  async function loadReturn(returnId) {
    const { rows } = await database.query(
      `SELECT rr.*, o.order_number, o.total_amount AS order_total, o.payment_method,
        d.method AS refund_destination_method, d.masked_destination AS refund_destination_masked,
        d.transaction_reference AS refund_transaction_reference,
        u.name AS customer_name, COALESCE(NULLIF(oa.email, ''), u.email) AS customer_email, u.phone AS customer_phone,
        oa.full_name, oa.phone, oa.email AS delivery_email, oa.address_line1, oa.address_line2, oa.landmark, oa.city, oa.state, oa.postal_code, oa.country
       FROM return_requests rr JOIN orders o ON o.id = rr.order_id JOIN users u ON u.id = rr.user_id
       LEFT JOIN cod_refund_destinations d ON d.return_id = rr.id
       LEFT JOIN order_addresses oa ON oa.order_id = o.id WHERE rr.id = $1`, [returnId]
    );
    if (!rows[0]) return null;
    const record = rows[0];
    const items = await database.query(
      `SELECT ri.quantity, ri.reason, ri.comments, ri.refund_amount, ri.refund_amount AS total_price,
        oi.product_name, oi.size, oi.color, oi.unit_price,
        (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = oi.product_id
         ORDER BY pi.is_primary DESC, pi.display_order, pi.id LIMIT 1) AS image_url
       FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
       WHERE ri.return_request_id = $1 ORDER BY ri.created_at, ri.id`, [returnId]
    );
    record.items = items.rows;
    record.address = {
      full_name: record.full_name, phone: record.phone, address_line1: record.address_line1, address_line2: record.address_line2,
      landmark: record.landmark, city: record.city, state: record.state, postal_code: record.postal_code, country: record.country
    };
    record.return_destination = environment.SHIPROCKET_PICKUP_LOCATION
      ? `Shiprocket saved location: ${String(environment.SHIPROCKET_PICKUP_LOCATION).slice(0, 100)}` : null;
    return record;
  }

  async function loadEventData(event) {
    const data = event.return_id ? await loadReturn(event.return_id) : await loadOrder(event.order_id);
    return data ? { ...data, ...(event.metadata || {}) } : null;
  }

  async function markSkipped(id, reason) {
    await database.query(`UPDATE transactional_email_events SET status = 'skipped', last_error = $2,
      updated_at = NOW() WHERE id = $1`, [id, reason]);
  }

  async function claim(eventKeys = null) {
    const params = [MAX_ATTEMPTS];
    let keys = '';
    if (Array.isArray(eventKeys) && eventKeys.length) {
      params.push(eventKeys);
      keys = `AND event_key = ANY($${params.length}::varchar[])`;
    }
    const { rows } = await database.query(
      `UPDATE transactional_email_events SET status = 'sending', attempt_count = attempt_count + 1,
         updated_at = NOW()
       WHERE id = (SELECT id FROM transactional_email_events
         WHERE status IN ('pending','failed') AND attempt_count < $1 AND next_attempt_at <= NOW() ${keys}
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *`, params
    );
    return rows[0] || null;
  }

  async function deliver(event) {
    const data = await loadEventData(event);
    if (!data) { await markSkipped(event.id, 'EMAIL_SOURCE_NOT_FOUND'); return 'skipped'; }
    if (CUSTOMER_EVENTS.has(event.event_type) && normalizedEmail(data.customer_email) !== normalizedEmail(event.recipient)) {
      await markSkipped(event.id, 'EMAIL_RECIPIENT_MISMATCH'); return 'skipped';
    }
    const message = buildEmail(event.event_type, data, environment);
    const { transporter, config } = mailer();
    const result = await transporter.sendMail({
      from: config.from, to: event.recipient, subject: safeSubject(message.subject), html: message.html, text: message.text
    });
    const providerMessageId = String(result?.messageId || '').replace(/[\r\n]/g, '').slice(0, 255) || null;
    await database.query(`UPDATE transactional_email_events SET status = 'sent', provider_message_id = $2,
      sent_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`, [event.id, providerMessageId]);
    if (event.event_type === 'ORDER_CONFIRMED_CUSTOMER' && event.order_id) {
      await database.query('UPDATE orders SET confirmation_email_sent_at = COALESCE(confirmation_email_sent_at, NOW()), updated_at = NOW() WHERE id = $1', [event.order_id]);
    }
    return 'sent';
  }

  async function processPendingEmails({ limit = 20, eventKeys = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid email queue batch size.');
    await database.query(`UPDATE transactional_email_events SET status = 'failed', last_error = 'EMAIL_SEND_INTERRUPTED',
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
        await database.query(`UPDATE transactional_email_events SET status = 'failed', last_error = $2,
          next_attempt_at = NOW() + ($3::text || ' minutes')::interval, updated_at = NOW() WHERE id = $1`,
        [event.id, safeCode(error.code), String(delayMinutes)]).catch(() => {});
        if (Number(event.attempt_count) >= MAX_ATTEMPTS) {
          console.error('Transactional email exhausted its retry limit.', { eventType: event.event_type, code: safeCode(error.code) });
        }
      }
    }
    return result;
  }

  async function notify(queue) {
    try {
      const keys = await queue();
      if (keys.length) return await processPendingEmails({ limit: keys.length, eventKeys: keys });
      return { sent: 0, failed: 0, skipped: 0 };
    } catch (error) {
      console.error('Transactional email event could not be queued.', { code: safeCode(error.code, 'EMAIL_QUEUE_FAILED') });
      return { sent: 0, failed: 1, skipped: 0 };
    }
  }

  return {
    processPendingEmails,
    orderConfirmed: orderId => notify(() => queueOrder(orderId, ['ORDER_CONFIRMED_CUSTOMER','ORDER_CONFIRMED_ADMIN'])),
    orderShipped: orderId => notify(() => queueOrder(orderId, ['ORDER_SHIPPED_CUSTOMER'])),
    orderOutForDelivery: orderId => notify(() => queueOrder(orderId, ['ORDER_OUT_FOR_DELIVERY_CUSTOMER'])),
    orderDelivered: orderId => notify(() => queueOrder(orderId, ['ORDER_DELIVERED_CUSTOMER'])),
    returnRequested: returnId => notify(() => queueReturn(returnId, ['RETURN_REQUESTED_CUSTOMER','RETURN_REQUESTED_ADMIN'])),
    returnPickupScheduled: returnId => notify(() => queueReturn(returnId, ['RETURN_PICKUP_SCHEDULED_CUSTOMER'])),
    returnPickedUp: returnId => notify(() => queueReturn(returnId, ['RETURN_PICKED_UP_CUSTOMER'])),
    returnReceived: returnId => notify(() => queueReturn(returnId, ['RETURN_RECEIVED_CUSTOMER'])),
    returnApproved: returnId => notify(() => queueReturn(returnId, ['RETURN_APPROVED_CUSTOMER'])),
    refundInitiated: (returnId, reference) => notify(() => queueReturn(returnId,
      ['REFUND_INITIATED_CUSTOMER','REFUND_INITIATED_ADMIN'], {}, String(reference || '').slice(0, 100))),
    refundCompleted: (returnId, reference) => notify(() => queueReturn(returnId,
      ['REFUND_COMPLETED_CUSTOMER','REFUND_COMPLETED_ADMIN'], {}, String(reference || '').slice(0, 100))),
    codRefundRequired: returnId => notify(() => queueReturn(returnId, ['COD_REFUND_REQUIRED_ADMIN'])),
    codRefundPending: returnId => notify(() => queueReturn(returnId,
      ['COD_REFUND_PENDING_CUSTOMER','COD_REFUND_PENDING_ADMIN'])),
    shipmentFailure: (orderId, failureCode) => notify(() => queueOrder(orderId, ['SHIPMENT_CREATION_FAILED_ADMIN'], { failure_code: safeCode(failureCode) })),
    returnFailure: (returnId, failureCode) => notify(() => queueReturn(returnId, ['RETURN_CREATION_FAILED_ADMIN'], { failure_code: safeCode(failureCode) })),
    refundFailure: (returnId, failureCode) => notify(() => queueReturn(returnId, ['REFUND_FAILED_ADMIN'], { failure_code: safeCode(failureCode) })),
    _insert: insert, _loadOrder: loadOrder, _loadReturn: loadReturn
  };
}

const service = createTransactionalEmailService();
module.exports = { ...service, createTransactionalEmailService, normalizedEmail, adminEmail, safeSubject, CUSTOMER_EVENTS };
