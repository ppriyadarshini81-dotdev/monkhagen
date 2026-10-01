const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createMsg91SmsClient, SEND_SMS_URL } = require('../services/msg91SmsService');
const { createTransactionalSmsService, EVENT_TYPE, SENDER_ID } = require('../services/transactionalSmsService');

const ORDER_ID = '10000000-0000-4000-8000-000000000001';
const TEMPLATE_ID = '6abe2afdbf1e70933007';

function fixture(overrides = {}, sendTemplate = async () => 'provider-message') {
  const order = {
    id: ORDER_ID,
    order_number: 'MH-20260921-144061F0',
    payment_method: 'razorpay',
    payment_status: 'paid',
    order_status: 'confirmed',
    phone: '+91 98765 43210',
    ...overrides
  };
  const events = new Map();
  const providerCalls = [];
  const provider = { async sendTemplate(request) { providerCalls.push(request); return sendTemplate(request); } };
  const database = { async query(sql, params = []) {
    const statement = String(sql);
    if (statement.includes('SELECT o.id, o.order_number')) return { rows: [order] };
    if (statement.includes('INSERT INTO transactional_sms_events')) {
      if (events.has(params[0])) return { rows: [] };
      const event = { id: `sms-${events.size + 1}`, event_key: params[0], event_type: params[1], order_id: params[2],
        recipient: params[3], metadata: JSON.parse(params[4]), status: 'pending', attempt_count: 0 };
      events.set(params[0], event);
      return { rows: [{ event_key: event.event_key }] };
    }
    if (statement.includes("SET status = 'sending'")) {
      const allowed = params[1] || null;
      const event = [...events.values()].find(value => ['pending','failed'].includes(value.status) &&
        value.attempt_count < params[0] && (!allowed || allowed.includes(value.event_key)));
      if (!event) return { rows: [] };
      event.status = 'sending'; event.attempt_count += 1;
      return { rows: [{ ...event }] };
    }
    if (statement.includes("SET status = 'sent'")) {
      const event = [...events.values()].find(value => value.id === params[0]);
      event.status = 'sent'; event.provider_message_id = params[1];
      return { rows: [] };
    }
    if (statement.includes("SET status = 'failed'")) {
      if (params[0] && String(params[0]).startsWith('sms-')) {
        const event = [...events.values()].find(value => value.id === params[0]);
        event.status = 'failed'; event.last_error = params[1];
      }
      return { rows: [] };
    }
    if (statement.includes("SET status = 'skipped'")) return { rows: [] };
    return { rows: [] };
  } };
  const service = createTransactionalSmsService({ database, provider,
    environment: { MSG91_ORDER_CONFIRMED_TEMPLATE_ID: TEMPLATE_ID } });
  return { service, providerCalls, events };
}

test('confirmed prepaid order sends the approved template with public order number and sender', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.orderConfirmed(ORDER_ID), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(f.providerCalls.length, 1);
  assert.deepEqual(f.providerCalls[0], {
    mobile: '919876543210', templateId: TEMPLATE_ID, senderId: 'KABAPP',
    variables: { var1: 'MH-20260921-144061F0' }
  });
  assert.notEqual(f.providerCalls[0].variables.var1, ORDER_ID);
});

test('confirmed COD order sends while pending or failed prepaid orders do not', async () => {
  const cod = fixture({ payment_method: 'cod', payment_status: 'pending' });
  assert.equal((await cod.service.orderConfirmed(ORDER_ID)).sent, 1);

  for (const status of ['pending', 'failed']) {
    const prepaid = fixture({ payment_status: status });
    assert.deepEqual(await prepaid.service.orderConfirmed(ORDER_ID), { sent: 0, failed: 0, skipped: 0 });
    assert.equal(prepaid.providerCalls.length, 0);
  }
});

test('database event key prevents duplicate webhook and COD retry messages', async () => {
  for (const payment of [
    { payment_method: 'razorpay', payment_status: 'paid' },
    { payment_method: 'cod', payment_status: 'pending' }
  ]) {
    const f = fixture(payment);
    await f.service.orderConfirmed(ORDER_ID);
    await f.service.orderConfirmed(ORDER_ID);
    assert.equal(f.providerCalls.length, 1);
    assert.deepEqual([...f.events.keys()], [`${EVENT_TYPE}:${ORDER_ID}`]);
  }
});

test('missing or invalid delivery phone skips SMS without failing the order', async () => {
  for (const phone of [null, '', '12345']) {
    const f = fixture({ phone });
    assert.deepEqual(await f.service.orderConfirmed(ORDER_ID), { sent: 0, failed: 0, skipped: 0 });
    assert.equal(f.providerCalls.length, 0);
    assert.equal(f.events.size, 0);
  }
});

test('MSG91 failure is recorded for retry and does not escape to order confirmation', async () => {
  const failure = Object.assign(new Error('private provider response'), { code: 'SMS_PROVIDER_UNAVAILABLE' });
  const f = fixture({}, async () => { throw failure; });
  assert.deepEqual(await f.service.orderConfirmed(ORDER_ID), { sent: 0, failed: 1, skipped: 0 });
  const event = [...f.events.values()][0];
  assert.equal(event.status, 'failed');
  assert.equal(event.last_error, 'SMS_PROVIDER_UNAVAILABLE');
});

test('MSG91 transactional client uses Flow v5 without exposing auth in the URL', async () => {
  const requests = [];
  const client = createMsg91SmsClient({ environment: { MSG91_AUTH_KEY: 'test-auth-key' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ type: 'success', message: 'message-id' }) };
    } });
  await client.sendTemplate({ mobile: '919876543210', templateId: TEMPLATE_ID, senderId: SENDER_ID,
    variables: { var1: 'MH-20260921-144061F0' } });
  assert.equal(requests[0].url, SEND_SMS_URL);
  assert.equal(requests[0].options.headers.authkey, 'test-auth-key');
  assert.doesNotMatch(requests[0].url, /test-auth-key/);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    template_id: TEMPLATE_ID, sender: 'KABAPP', short_url: '0', realTimeResponse: '1',
    recipients: [{ mobiles: '919876543210', var1: 'MH-20260921-144061F0' }]
  });
});

test('SMS migration provides durable unique idempotency and retry state', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '014_transactional_sms_events.sql'), 'utf8');
  assert.match(sql, /event_key VARCHAR\(255\) NOT NULL UNIQUE/i);
  assert.match(sql, /status IN \('pending', 'sending', 'sent', 'failed', 'skipped'\)/i);
  assert.match(sql, /order_id UUID REFERENCES orders\(id\)/i);
});
