const crypto = require('crypto');
const { pool } = require('../config/db');
const { getRazorpay } = require('../config/razorpay');
const { sendOrderConfirmation } = require('./orderConfirmationEmail');

const CURRENCY = 'INR';
const FREE_SHIPPING_THRESHOLD_PAISE = 299900;
const STANDARD_SHIPPING_PAISE = 9900;
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

    const existing = await client.query(
      `SELECT id, order_number, total_amount, razorpay_order_id
       FROM orders WHERE checkout_token = $1 AND user_id = $2
       FOR UPDATE`,
      [checkoutToken, userId]
    );
    if (existing.rows[0]) {
      const order = existing.rows[0];
      if (!order.razorpay_order_id) throw httpError(409, 'This checkout attempt is still being prepared.');
      await client.query('COMMIT');
      return {
        keyId,
        razorpayOrderId: order.razorpay_order_id,
        amount: toPaise(order.total_amount),
        currency: CURRENCY,
        localOrderId: order.id,
        orderNumber: order.order_number
      };
    }

    const cartResult = await client.query(
      `SELECT id FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
      [userId]
    );
    const cart = cartResult.rows[0];
    if (!cart) throw httpError(400, 'Cart is empty.');

    const addressResult = await client.query(
      `SELECT * FROM customer_addresses WHERE id = $1 AND user_id = $2`,
      [addressId, userId]
    );
    const address = addressResult.rows[0];
    if (!address) throw httpError(400, 'Select a shipping address saved to your account.');

    const itemsResult = await client.query(
      `SELECT ci.product_id, ci.variant_id, ci.quantity,
              p.name AS product_name, p.is_active AS product_active,
              pv.size, pv.color, pv.sku, pv.stock, pv.is_active AS variant_active,
              COALESCE(pv.price, p.base_price) AS unit_price
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at
       FOR UPDATE OF ci, p, pv`,
      [cart.id]
    );
    if (itemsResult.rows.length === 0) throw httpError(400, 'Cart is empty.');

    let subtotalPaise = 0;
    for (const item of itemsResult.rows) {
      if (!item.product_active || !item.variant_active) {
        throw httpError(409, `${item.product_name} is no longer available.`);
      }
      if (item.stock < item.quantity) {
        throw httpError(409, `Only ${item.stock} item(s) of ${item.product_name} (${item.size}/${item.color}) are available.`);
      }
      subtotalPaise += toPaise(item.unit_price) * item.quantity;
    }
    const shippingPaise = subtotalPaise >= FREE_SHIPPING_THRESHOLD_PAISE ? 0 : STANDARD_SHIPPING_PAISE;
    const totalPaise = subtotalPaise + shippingPaise;
    const localOrderNumber = orderNumber();

    const orderResult = await client.query(
      `INSERT INTO orders
         (user_id, cart_id, checkout_token, order_number, subtotal, discount_amount,
          shipping_amount, total_amount, payment_method, payment_status, order_status)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,'razorpay','pending','placed')
       RETURNING id`,
      [userId, cart.id, checkoutToken, localOrderNumber, fromPaise(subtotalPaise),
       fromPaise(shippingPaise), fromPaise(totalPaise)]
    );
    const localOrderId = orderResult.rows[0].id;

    await client.query(
      `INSERT INTO order_addresses
         (order_id, full_name, phone, address_line1, address_line2, landmark,
          city, state, postal_code, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [localOrderId, address.full_name, address.phone, address.address_line1,
       address.address_line2, address.landmark, address.city, address.state,
       address.postal_code, address.country]
    );

    for (const item of itemsResult.rows) {
      const unitPricePaise = toPaise(item.unit_price);
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, variant_id, product_name, sku, size, color,
            quantity, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [localOrderId, item.product_id, item.variant_id, item.product_name,
         item.sku, item.size, item.color, item.quantity, fromPaise(unitPricePaise),
         fromPaise(unitPricePaise * item.quantity)]
      );
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: totalPaise,
      currency: CURRENCY,
      receipt: localOrderNumber,
      notes: { local_order_id: localOrderId, order_number: localOrderNumber }
    });
    if (!razorpayOrder?.id) throw httpError(502, 'Razorpay did not return an order ID.');

    await client.query(
      `UPDATE orders SET razorpay_order_id = $1, updated_at = NOW() WHERE id = $2`,
      [razorpayOrder.id, localOrderId]
    );
    await client.query('COMMIT');

    return {
      keyId,
      razorpayOrderId: razorpayOrder.id,
      amount: totalPaise,
      currency: CURRENCY,
      localOrderId,
      orderNumber: localOrderNumber
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function finalizePaidOrder(client, { razorpayOrderId, paymentId, signature = null, amount, currency }) {
  const result = await client.query(
    `SELECT * FROM orders WHERE razorpay_order_id = $1 FOR UPDATE`,
    [razorpayOrderId]
  );
  const order = result.rows[0];
  if (!order) throw httpError(404, 'Local order not found for this Razorpay order.');

  if (order.payment_status === 'paid') {
    if (order.razorpay_payment_id !== paymentId) {
      throw httpError(409, 'This order is already linked to another payment.');
    }
    return { order, newlyFinalized: false };
  }
  if (amount !== undefined && Number(amount) !== toPaise(order.total_amount)) {
    throw httpError(409, 'Payment amount does not match the order total.');
  }
  if (currency && currency !== CURRENCY) {
    throw httpError(409, 'Payment currency does not match the order currency.');
  }

  const itemResult = await client.query(
    `SELECT variant_id, SUM(quantity)::int AS quantity
     FROM order_items WHERE order_id = $1 GROUP BY variant_id ORDER BY variant_id`,
    [order.id]
  );
  for (const item of itemResult.rows) {
    const stockResult = await client.query(
      `UPDATE product_variants
       SET stock = stock - $1, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE AND stock >= $1
       RETURNING id`,
      [item.quantity, item.variant_id]
    );
    if (!stockResult.rows[0]) {
      throw httpError(409, 'Payment was captured, but an item is now out of stock. Manual review is required.');
    }
  }

  const updated = await client.query(
    `UPDATE orders
     SET razorpay_payment_id = $1,
         razorpay_signature = COALESCE($2, razorpay_signature),
         payment_status = 'paid', order_status = 'confirmed', paid_at = NOW(),
         inventory_deducted_at = NOW(), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [paymentId, signature, order.id]
  );
  if (order.cart_id) {
    await client.query(
      `UPDATE carts SET status = 'converted', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [order.cart_id, order.user_id]
    );
  }
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

  await sendOrderConfirmation(order.id);
  return {
    localOrderId: order.id,
    orderNumber: finalization.order.order_number,
    paymentStatus: finalization.order.payment_status,
    orderStatus: finalization.order.order_status
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
      const finalization = await finalizePaidOrder(client, {
        razorpayOrderId,
        paymentId,
        amount: payment?.amount ?? razorpayOrder?.amount_paid,
        currency: payment?.currency ?? razorpayOrder?.currency
      });
      finalizedOrderId = finalization.order.id;
    } else if (eventType === 'payment.failed' && payment?.order_id) {
      await client.query(
        `UPDATE orders SET payment_status = 'failed', updated_at = NOW()
         WHERE razorpay_order_id = $1 AND payment_status = 'pending'`,
        [payment.order_id]
      );
    }
    // refund.processed is authenticated and recorded above for future refund integration.
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (finalizedOrderId) await sendOrderConfirmation(finalizedOrderId);
  return { duplicate: false };
}

module.exports = {
  createPaymentOrder,
  verifyPayment,
  processWebhook,
  verifyCheckoutSignature,
  verifyWebhookSignature
};
