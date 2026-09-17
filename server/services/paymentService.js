const crypto = require('crypto');
const { pool } = require('../config/db');
const { getRazorpay } = require('../config/razorpay');
const { sendOrderConfirmation } = require('./orderConfirmationEmail');
const Shipment = require('../models/Shipment');
const shipping = require('./shippingService');
const inventory = require('./inventoryService');

const CURRENCY = 'INR';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toPaise(value) {
  return Math.round(Number(value) * 100);
}

function fromPaise(value) {
  return (value / 100).toFixed(2);
}

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MH-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function safeEqualHex(expected, received) {
  if (typeof received !== 'string' || !/^[a-f0-9]+$/i.test(received)) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function verifyCheckoutSignature(expectedOrderId, paymentId, signature) {
  if (!expectedOrderId || !paymentId || !process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${expectedOrderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw httpError(503, 'Razorpay webhook secret is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

async function createPaymentOrder(userId, { addressId, checkoutToken }) {
  if (!UUID_RE.test(addressId || '') || !UUID_RE.test(checkoutToken || '')) {
    throw httpError(400, 'A valid saved address and checkout attempt are required.');
  }
  const { razorpay, keyId } = getRazorpay();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checkout:${userId}`]);
    await inventory.releaseExpiredReservations(client);
    const existing = await client.query('SELECT * FROM orders WHERE checkout_token = $1 AND user_id = $2 FOR UPDATE', [checkoutToken, userId]);
    if (existing.rows[0]) {
      const order = existing.rows[0];
      if (order.payment_status !== 'pending' || !order.inventory_reserved_at || order.inventory_released_at ||
          order.order_status === 'cancelled' || order.fulfillment_hold_reason || !order.razorpay_order_id) {
        throw httpError(409, 'This checkout attempt is unavailable. Start a new checkout.');
      }
      await client.query('COMMIT');
      return { keyId, razorpayOrderId: order.razorpay_order_id, amount: toPaise(order.total_amount),
        currency: CURRENCY, localOrderId: order.id, orderNumber: order.order_number };
    }
    const { cart, address, items, amount } = await inventory.checkoutSnapshot(client, userId, addressId);
    const pending = await client.query(`SELECT id FROM orders WHERE cart_id = $1 AND payment_status = 'pending'
      AND inventory_reserved_at IS NOT NULL AND inventory_released_at IS NULL FOR UPDATE`, [cart.id]);
    if (pending.rows.length) throw httpError(409, 'A checkout for this cart is already pending. Retry it or wait for it to expire.');
    await inventory.deduct(client, items);
    const localOrderNumber = orderNumber();
    const result = await client.query(`INSERT INTO orders
      (user_id, cart_id, checkout_token, order_number, subtotal, discount_amount, shipping_amount, total_amount,
       payment_method, payment_status, order_status, inventory_reserved_at, inventory_reservation_expires_at)
      VALUES ($1,$2,$3,$4,$5,0,0,$5,'razorpay','pending','placed',NOW(),NOW() + INTERVAL '15 minutes') RETURNING id`,
      [userId, cart.id, checkoutToken, localOrderNumber, fromPaise(amount)]);
    const localOrderId = result.rows[0].id;
    await inventory.snapshotAddress(client, localOrderId, address);
    await inventory.snapshotItems(client, localOrderId, items);
    const remote = await razorpay.orders.create({ amount, currency: CURRENCY, receipt: localOrderNumber,
      notes: { local_order_id: localOrderId, order_number: localOrderNumber } });
    if (!remote?.id) throw httpError(502, 'Razorpay did not return an order ID.');
    await client.query('UPDATE orders SET razorpay_order_id = $1, updated_at = NOW() WHERE id = $2', [remote.id, localOrderId]);
    await client.query('COMMIT');
    return { keyId, razorpayOrderId: remote.id, amount, currency: CURRENCY, localOrderId, orderNumber: localOrderNumber };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function finalizePaidOrder(client, { razorpayOrderId, paymentId, signature = null, amount, currency }) {
  const result = await client.query(
    `SELECT * FROM orders WHERE razorpay_order_id = $1 FOR UPDATE`,
    [razorpayOrderId]
  );
  const order = result.rows[0];
  if (!order) throw httpError(404, 'Local order not found for this Razorpay order.');

  if (!Number.isSafeInteger(Number(amount)) || Number(amount) !== toPaise(order.total_amount)) {
    throw httpError(409, 'Payment amount does not match the order total.');
  }
  if (currency !== CURRENCY) throw httpError(409, 'Payment currency does not match the order currency.');
  if (['paid', 'refunded', 'partially_refunded'].includes(order.payment_status)) {
    if (order.razorpay_payment_id !== paymentId) {
      throw httpError(409, 'This order is already linked to another payment.');
    }
    if (order.payment_status === 'paid' && !order.fulfillment_hold_reason) await Shipment.enqueue(client, order.id);
    return { order, newlyFinalized: false };
  }
  let holdReason = order.fulfillment_hold_reason || null;
  let allocated = Boolean(order.inventory_deducted_at || (order.inventory_reserved_at && !order.inventory_released_at));
  if (['cancelled', 'returned'].includes(order.order_status)) {
    holdReason = 'ORDER_CANCELLED_CAPTURE_REVIEW';
    await inventory.releaseReservation(client, order);
    allocated = false;
  } else if (!allocated) {
    const itemResult = await client.query(
    `SELECT variant_id, SUM(quantity)::int AS quantity
     FROM order_items WHERE order_id = $1 GROUP BY variant_id ORDER BY variant_id`,
    [order.id]
  );
    await client.query('SAVEPOINT captured_inventory');
    try {
      if (!itemResult.rows.length) throw httpError(409, 'Order inventory needs review.');
      await inventory.deduct(client, itemResult.rows);
      allocated = true;
      await client.query('RELEASE SAVEPOINT captured_inventory');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT captured_inventory');
      if (error.status !== 409) throw error;
      holdReason = 'ORDER_INVENTORY_REVIEW_REQUIRED';
    }
  }

  const updated = await client.query(
    `UPDATE orders
     SET razorpay_payment_id = $1,
         razorpay_signature = COALESCE($2, razorpay_signature),
         payment_status = 'paid', order_status = CASE WHEN order_status IN ('cancelled','returned') THEN order_status
           WHEN $4::text IS NOT NULL THEN 'processing' ELSE 'confirmed' END, paid_at = NOW(),
         inventory_deducted_at = CASE WHEN $5 THEN COALESCE(inventory_deducted_at, NOW()) ELSE inventory_deducted_at END,
         fulfillment_hold_reason = $4, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [paymentId, signature, order.id, holdReason, allocated]
  );
  if (order.cart_id) {
    await client.query(
      `UPDATE carts SET status = 'converted', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [order.cart_id, order.user_id]
    );
  }
  if (!holdReason) await Shipment.enqueue(client, order.id);
  return { order: updated.rows[0], newlyFinalized: true };
}

async function verifyPayment(userId, { localOrderId, razorpayPaymentId, razorpayOrderId, razorpaySignature }) {
  if (!UUID_RE.test(localOrderId || '') || !razorpayPaymentId || !razorpaySignature) {
    throw httpError(400, 'Complete payment verification details are required.');
  }
  const orderLookup = await pool.query(
    `SELECT id, user_id, razorpay_order_id FROM orders WHERE id = $1 AND user_id = $2`,
    [localOrderId, userId]
  );
  const order = orderLookup.rows[0];
  if (!order) throw httpError(404, 'Order not found.');
  if (razorpayOrderId && razorpayOrderId !== order.razorpay_order_id) {
    throw httpError(400, 'Payment order ID does not match.');
  }
  if (!verifyCheckoutSignature(order.razorpay_order_id, razorpayPaymentId, razorpaySignature)) {
    throw httpError(400, 'Payment signature verification failed.');
  }

  const { razorpay } = getRazorpay();
  const payment = await razorpay.payments.fetch(razorpayPaymentId);
  if (payment.order_id !== order.razorpay_order_id || payment.status !== 'captured') {
    throw httpError(409, 'Payment is not captured yet. Confirmation will follow after Razorpay confirms it.');
  }

  const client = await pool.connect();
  let finalization;
  try {
    await client.query('BEGIN');
    finalization = await finalizePaidOrder(client, {
      razorpayOrderId: order.razorpay_order_id,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
      amount: payment.amount,
      currency: payment.currency
    });
    if (finalization.order.user_id !== userId) throw httpError(403, 'This order belongs to another customer.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // The queue row is committed. Shipping failures cannot roll back or fail a captured payment.
  if (!process.env.VERCEL) {
    if (finalization.order.payment_status === 'paid' && !finalization.order.fulfillment_hold_reason) void shipping.processPendingOrder(order.id);
    if (finalization.order.payment_status === 'paid') void sendOrderConfirmation(order.id).catch(() => console.warn('Order confirmation email will be retried.'));
  }
  return {
    localOrderId: order.id,
    orderNumber: finalization.order.order_number,
    paymentStatus: finalization.order.payment_status,
    orderStatus: finalization.order.order_status,
    fulfillmentHoldReason: finalization.order.fulfillment_hold_reason || null
  };
}

async function processWebhook(rawBody, headers) {
  if (!Buffer.isBuffer(rawBody)) throw httpError(400, 'Raw webhook body is required.');
  if (!verifyWebhookSignature(rawBody, headers['x-razorpay-signature'])) {
    throw httpError(400, 'Invalid Razorpay webhook signature.');
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { throw httpError(400, 'Invalid webhook JSON.'); }

  const eventId = headers['x-razorpay-event-id'] || crypto.createHash('sha256').update(rawBody).digest('hex');
  const eventType = payload.event || 'unknown';
  const payment = payload.payload?.payment?.entity;
  const razorpayOrder = payload.payload?.order?.entity;
  const client = await pool.connect();
  let finalizedOrderId = null;
  let dispatchAllowed = false;
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `INSERT INTO payment_webhook_events (event_id, event_type)
       VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [String(eventId), eventType]
    );
    if (!claim.rows[0]) {
      await client.query('COMMIT');
      return { duplicate: true };
    }

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const razorpayOrderId = payment?.order_id || razorpayOrder?.id;
      const paymentId = payment?.id;
      if (!razorpayOrderId || !paymentId) throw httpError(400, 'Paid webhook is missing payment details.');
      if (payment.status !== 'captured' || payment.amount == null || !payment.currency) {
        throw httpError(400, 'Paid webhook must contain a captured payment with amount and currency.');
      }
      const finalization = await finalizePaidOrder(client, {
        razorpayOrderId,
        paymentId,
        amount: payment?.amount ?? razorpayOrder?.amount_paid,
        currency: payment?.currency ?? razorpayOrder?.currency
      });
      finalizedOrderId = finalization.order.id;
      dispatchAllowed = finalization.order.payment_status === 'paid' && !finalization.order.fulfillment_hold_reason;
    } else if (eventType === 'payment.failed' && payment?.order_id) {
      const pending = await client.query("SELECT * FROM orders WHERE razorpay_order_id = $1 AND payment_status = 'pending' FOR UPDATE", [payment.order_id]);
      if (pending.rows[0]?.payment_status === 'pending') {
        await inventory.releaseReservation(client, pending.rows[0]);
        await client.query("UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND payment_status = 'pending'", [pending.rows[0].id]);
      }
    } else if (eventType === 'refund.processed') {
      await recordProcessedRefund(client, payload.payload?.refund?.entity, payment);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (finalizedOrderId && !process.env.VERCEL) {
    // The worker rechecks payment/hold state under its own durable lease.
    if (dispatchAllowed) void shipping.processPendingOrder(finalizedOrderId);
    void sendOrderConfirmation(finalizedOrderId).catch(() => console.warn('Order confirmation email will be retried.'));
  }
  return { duplicate: false };
}

async function recordProcessedRefund(client, refund, payment) {
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_]{1,255}$/.test(value);
  if (!refund || !validId(refund.id) || !validId(refund.payment_id) || refund.status !== 'processed' ||
      refund.currency !== CURRENCY || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
    throw httpError(400, 'Refund webhook contains invalid processed-refund details.');
  }
  let result = await client.query('SELECT * FROM orders WHERE razorpay_payment_id = $1 FOR UPDATE', [refund.payment_id]);
  let order = result.rows[0];
  // Refund and capture webhook delivery order is not guaranteed. Establish
  // captured financial state first, in this same transaction, if necessary.
  if (!order && !payment) {
    const { razorpay } = getRazorpay();
    payment = await razorpay.payments.fetch(refund.payment_id);
  }
  if (!order && payment?.id === refund.payment_id && ['captured','refunded'].includes(payment.status) && validId(payment.order_id)) {
    order = (await finalizePaidOrder(client, { razorpayOrderId: payment.order_id, paymentId: payment.id,
      amount: payment.amount, currency: payment.currency })).order;
  }
  if (!order || order.razorpay_payment_id !== refund.payment_id) throw httpError(404, 'Refund payment is not linked to an order.');
  const total = toPaise(order.total_amount);
  if (refund.amount > total) throw httpError(409, 'Refund exceeds the order payment.');
  if (payment && (payment.id !== refund.payment_id || payment.currency !== CURRENCY || Number(payment.amount) !== total)) {
    throw httpError(409, 'Refund payment does not match the order.');
  }
  const authoritativeTotal = payment?.amount_refunded;
  if (authoritativeTotal != null && (!Number.isSafeInteger(authoritativeTotal) ||
      authoritativeTotal < refund.amount || authoritativeTotal > total)) throw httpError(409, 'Invalid cumulative refund amount.');
  await client.query(`INSERT INTO payment_refunds (refund_id, order_id, payment_id, amount)
    VALUES ($1,$2,$3,$4) ON CONFLICT (refund_id) DO NOTHING`, [refund.id, order.id, refund.payment_id, fromPaise(refund.amount)]);
  const recorded = await client.query('SELECT order_id, payment_id, amount FROM payment_refunds WHERE refund_id = $1', [refund.id]);
  if (!recorded.rows[0] || recorded.rows[0].order_id !== order.id || recorded.rows[0].payment_id !== refund.payment_id ||
      toPaise(recorded.rows[0].amount) !== refund.amount) throw httpError(409, 'Refund ID is already linked to different refund details.');
  const sum = await client.query('SELECT COALESCE(SUM(amount), 0) AS amount FROM payment_refunds WHERE order_id = $1', [order.id]);
  const refunded = Math.max(toPaise(sum.rows[0].amount), toPaise(order.refunded_amount || 0), authoritativeTotal || 0);
  if (refunded > total) throw httpError(409, 'Cumulative refunds exceed the order payment.');
  await client.query(`UPDATE orders SET refunded_amount = $1,
    payment_status = $2, fulfillment_hold_reason = 'ORDER_REFUND_REVIEW_REQUIRED', updated_at = NOW() WHERE id = $3`,
    [fromPaise(refunded), refunded === total ? 'refunded' : 'partially_refunded', order.id]);
}

module.exports = {
  createPaymentOrder,
  verifyPayment,
  processWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature
};
