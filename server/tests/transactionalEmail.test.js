const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionalEmailService } = require('../services/transactionalEmailService');
const { buildEmail, escapeHtml } = require('../services/transactionalEmailTemplates');

const ORDER = '10000000-0000-4000-8000-000000000001';
const RETURN = '20000000-0000-4000-8000-000000000001';

function fixture({ failMail = false } = {}) {
  const sent = [];
  const events = [];
  const order = {
    id: ORDER, order_number: 'MH-TEST-100', customer_name: 'Asha <script>alert(1)</script>', customer_email: 'buyer@example.test',
    customer_phone: '9876543210', full_name: 'Asha Customer', phone: '9876543210', address_line1: '10 <Market> Road',
    city: 'Pune', state: 'Maharashtra', postal_code: '411001', country: 'India', subtotal: '1299.00',
    discount_amount: '100.00', shipping_amount: '0.00', total_amount: '1199.00', payment_method: 'razorpay',
    payment_status: 'paid', order_status: 'confirmed', created_at: '2026-10-01T04:00:00Z', delivered_at: '2026-10-04T06:00:00Z',
    awb_code: 'SAFEAWB', courier_name: 'Test Courier', tracking_url: 'https://tracking.example.test/SAFEAWB',
    estimated_delivery: '05 Oct 2026', shipping_status: 'created', shiprocket_order_id: 123,
    razorpay_payment_id: 'pay_private', razorpay_order_id: 'order_private'
  };
  const orderItems = [{ product_name: 'Black <b>Shirt</b>', size: 'M', color: 'Black', quantity: 1,
    unit_price: '1299.00', total_price: '1299.00', product_slug: 'black-shirt', image_url: 'https://cdn.example.test/shirt.jpg' }];
  const returned = {
    id: RETURN, order_id: ORDER, return_number: 'R-TEST-100', order_number: order.order_number, order_total: order.total_amount,
    customer_name: order.customer_name, customer_email: order.customer_email, customer_phone: order.customer_phone,
    full_name: order.full_name, phone: order.phone, address_line1: order.address_line1, city: order.city, state: order.state,
    postal_code: order.postal_code, country: order.country, refund_amount: '1099.00', payment_method: 'razorpay',
    status: 'received', return_awb: 'RETURNAWB', provider_status: 'RETURN DELIVERED', requested_at: '2026-10-05T04:00:00Z',
    refund_initiated_at: '2026-10-06T04:00:00Z', refunded_at: '2026-10-07T04:00:00Z', updated_at: '2026-10-07T04:00:00Z',
    razorpay_refund_id: 'rfnd_private'
  };
  const returnItems = [{ product_name: 'Black <b>Shirt</b>', size: 'M', color: 'Black', quantity: 1,
    reason: 'size_issue', comments: '<img src=x onerror=alert(1)>', refund_amount: '1099.00', total_price: '1099.00',
    image_url: 'https://cdn.example.test/shirt.jpg' }];

  const database = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT u.email FROM orders')) return { rows: [{ email: order.customer_email }] };
    if (sql.startsWith('SELECT u.email FROM return_requests')) return { rows: [{ email: returned.customer_email }] };
    if (sql.startsWith('INSERT INTO transactional_email_events')) {
      if (events.some(event => event.event_key === params[0])) return { rows: [] };
      events.push({ id: `event-${events.length + 1}`, event_key: params[0], event_type: params[1], order_id: params[2],
        return_id: params[3], recipient: params[4], metadata: JSON.parse(params[5]), status: 'pending', attempt_count: 0,
        next_attempt_at: new Date(), created_at: new Date(), updated_at: new Date() });
      return { rows: [{ event_key: params[0] }] };
    }
    if (sql.startsWith("UPDATE transactional_email_events SET status = 'failed', last_error = 'EMAIL_SEND_INTERRUPTED'")) return { rows: [] };
    if (sql.includes("SET status = 'sending'")) {
      const allowed = params[1] || null;
      const event = events.find(value => ['pending','failed'].includes(value.status) && value.attempt_count < params[0] &&
        new Date(value.next_attempt_at).getTime() <= Date.now() &&
        (!allowed || allowed.includes(value.event_key)));
      if (!event) return { rows: [] };
      event.status = 'sending'; event.attempt_count += 1; event.updated_at = new Date();
      return { rows: [{ ...event }] };
    }
    if (sql.startsWith('SELECT o.*, u.name AS customer_name')) return { rows: [{ ...order }] };
    if (sql.startsWith('SELECT oi.*, p.slug AS product_slug')) return { rows: orderItems.map(item => ({ ...item })) };
    if (sql.startsWith('SELECT rr.*, o.order_number')) return { rows: [{ ...returned }] };
    if (sql.startsWith('SELECT ri.quantity')) return { rows: returnItems.map(item => ({ ...item })) };
    if (sql.includes("SET status = 'sent'")) {
      const event = events.find(value => value.id === params[0]); Object.assign(event, { status: 'sent', provider_message_id: params[1] });
      return { rows: [] };
    }
    if (sql.includes("SET status = 'failed'")) {
      const event = events.find(value => value.id === params[0]); Object.assign(event, {
        status: 'failed', last_error: params[1], next_attempt_at: new Date(Date.now() + Number(params[2] || 5) * 60000)
      });
      return { rows: [] };
    }
    if (sql.includes("SET status = 'skipped'")) {
      const event = events.find(value => value.id === params[0]); Object.assign(event, { status: 'skipped', last_error: params[1] });
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE orders SET confirmation_email_sent_at')) return { rows: [] };
    throw new Error(`Unexpected test SQL: ${sql}`);
  } };
  const mailer = () => ({ config: { from: 'MONK HAGEN <official@monkhagen.in>' }, transporter: { sendMail: async message => {
    sent.push(message);
    if (failMail) throw Object.assign(new Error('simulated SMTP failure'), { code: 'ETIMEDOUT' });
    return { messageId: `mock-${sent.length}` };
  } } });
  const service = createTransactionalEmailService({ database, mailer, environment: {
    CONTACT_EMAIL: 'operations@example.test', PUBLIC_SITE_URL: 'https://monkhagen.in', SHIPROCKET_PICKUP_LOCATION: 'work'
  } });
  return { service, sent, events, order, returned, orderItems, returnItems };
}

test('customer order-confirmed and admin new-order emails use correct recipients and authoritative totals', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.orderConfirmed(ORDER), { sent: 2, failed: 0, skipped: 0 });
  assert.deepEqual(f.sent.map(message => message.to), ['buyer@example.test', 'operations@example.test']);
  assert.match(f.sent[0].subject, /Order Confirmed.*MH-TEST-100/);
  assert.match(f.sent[0].html, /₹1,199\.00/);
  assert.match(f.sent[1].subject, /New Order Received/);
  assert.match(f.sent[1].html, /Shiprocket order status/);
});

test('duplicate order event does not send duplicate customer or admin email', async () => {
  const f = fixture();
  await f.service.orderConfirmed(ORDER);
  await f.service.orderConfirmed(ORDER);
  assert.equal(f.sent.length, 2);
  assert.equal(new Set(f.events.map(event => event.event_key)).size, 2);
});

test('shipped, out-for-delivery and delivered emails are distinct and do not invent COD dues for prepaid', async () => {
  const f = fixture();
  await f.service.orderShipped(ORDER);
  await f.service.orderOutForDelivery(ORDER);
  await f.service.orderDelivered(ORDER);
  assert.match(f.sent[0].subject, /Has Shipped/);
  assert.match(f.sent[1].subject, /Out for Delivery/);
  assert.doesNotMatch(f.sent[1].html, /Amount to pay/i);
  assert.match(f.sent[2].subject, /Has Been Delivered/);
  assert.match(f.sent[2].html, /Rate Your Purchase/);
  assert.match(f.sent[2].html, /review=write/);
});

test('customer and admin return-request emails state expected refund without claiming pickup or payment', async () => {
  const f = fixture(); f.returned.status = 'return_created';
  await f.service.returnRequested(RETURN);
  assert.equal(f.sent[0].to, 'buyer@example.test');
  assert.match(f.sent[0].html, /expected refund amount/i);
  assert.match(f.sent[0].html, /once your return pickup is arranged/i);
  assert.doesNotMatch(f.sent[0].html, /refund has been processed/i);
  assert.equal(f.sent[1].to, 'operations@example.test');
  assert.match(f.sent[1].html, /Shiprocket saved location: work/);
  assert.match(f.sent[1].html, /Review Return/);
});

test('pickup scheduled, picked-up, received and approved customer return emails use actual state wording', async () => {
  const f = fixture();
  await f.service.returnPickupScheduled(RETURN);
  await f.service.returnPickedUp(RETURN);
  await f.service.returnReceived(RETURN);
  await f.service.returnApproved(RETURN);
  assert.match(f.sent[0].subject, /Pickup Has Been Scheduled/);
  assert.match(f.sent[0].html, /securely packed and ready/);
  assert.match(f.sent[1].subject, /Picked Up/);
  assert.match(f.sent[2].subject, /Received Your Return/);
  assert.match(f.sent[2].html, /inspect it/i);
  assert.match(f.sent[3].subject, /Return Has Been Approved/);
  assert.match(f.sent[3].html, /original payment method/i);
});

test('prepaid refund initiated and completed create separate customer and admin notifications', async () => {
  const f = fixture();
  await f.service.refundInitiated(RETURN, 'rfnd_test');
  await f.service.refundCompleted(RETURN, 'rfnd_test');
  assert.equal(f.sent.length, 4);
  assert.match(f.sent[0].subject, /Refund Initiated/);
  assert.match(f.sent[0].html, /has been initiated/i);
  assert.match(f.sent[2].subject, /Refund Completed/);
  assert.match(f.sent[2].html, /has been processed/i);
  assert.equal(f.sent[1].to, 'operations@example.test');
  assert.equal(f.sent[3].to, 'operations@example.test');
});

test('COD approval asks for a destination and pending/completed messages use the manual COD flow', async () => {
  const f = fixture(); f.returned.payment_method = 'cod';
  await f.service.returnApproved(RETURN);
  await f.service.codRefundRequired(RETURN);
  assert.equal(f.sent[0].to, 'buyer@example.test');
  assert.match(f.sent[0].html, /provide a UPI ID or bank account/i);
  assert.equal(f.sent[1].to, 'operations@example.test');
  assert.match(f.sent[1].subject, /destination required/i);

  f.returned.refund_destination_method = 'UPI';
  f.returned.refund_destination_masked = 'as***@bank';
  await f.service.codRefundPending(RETURN);
  assert.equal(f.sent[2].to, 'buyer@example.test');
  assert.match(f.sent[2].subject, /COD Refund Details Received/);
  assert.match(f.sent[2].html, /remains pending/i);
  assert.match(f.sent[2].html, /as\*\*\*@bank/);
  assert.doesNotMatch(f.sent[2].html, /Razorpay|original payment method/i);

  f.returned.refund_transaction_reference = 'UTR123456';
  await f.service.refundCompleted(RETURN, 'UTR123456');
  assert.match(f.sent[4].subject, /Refund Completed/);
  assert.match(f.sent[4].html, /UTR123456/);
  assert.match(f.sent[4].html, /destination you provided/i);
});

test('SMTP failure is recorded for retry and never escapes into the business caller', async () => {
  const f = fixture({ failMail: true });
  const result = await f.service.orderConfirmed(ORDER);
  assert.equal(result.failed, 2);
  assert.ok(f.events.every(event => event.status === 'failed' && event.attempt_count === 1));
});

test('customer-controlled HTML is escaped and private provider identifiers are absent from customer templates', async () => {
  const f = fixture();
  await f.service.orderConfirmed(ORDER);
  assert.doesNotMatch(f.sent[0].html, /<script>|<b>Shirt<\/b>/);
  assert.match(f.sent[0].html, /&lt;script&gt;|&lt;b&gt;Shirt&lt;\/b&gt;/);
  assert.doesNotMatch(f.sent[0].html, /pay_private|order_private|123/);
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});

test('admin operational failure emails contain safe categories without payloads or secrets', async () => {
  const f = fixture();
  await f.service.shipmentFailure(ORDER, 'SHIPROCKET_AUTH_FAILED');
  await f.service.returnFailure(RETURN, 'RETURN_PROVIDER_FAILED');
  await f.service.refundFailure(RETURN, 'REFUND_RECONCILIATION_REQUIRED');
  assert.equal(f.sent.length, 3);
  assert.ok(f.sent.every(message => message.to === 'operations@example.test' && /ACTION REQUIRED/.test(message.subject)));
  assert.ok(f.sent.every(message => !/pay_private|rfnd_private|authorization/i.test(message.html)));
});

test('every email includes HTML branding and a plain-text fallback', async () => {
  const f = fixture();
  await f.service.returnReceived(RETURN);
  assert.match(f.sent[0].html, /MONK HAGEN/);
  assert.match(f.sent[0].html, /official@monkhagen\.in/);
  assert.match(f.sent[0].text, /MONK HAGEN/);
  assert.doesNotMatch(f.sent[0].text, /<script|<img/i);
});

test('invalid customer recipient is skipped while configured admin recipient remains usable', async () => {
  const f = fixture(); f.order.customer_email = 'bad\r\nBcc: attacker@example.test';
  await f.service.orderConfirmed(ORDER);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'operations@example.test');
});

test('template builder rejects unsupported events instead of emitting misleading mail', () => {
  assert.throws(() => buildEmail('UNKNOWN_EVENT', {}), /Unsupported transactional email event/);
});
