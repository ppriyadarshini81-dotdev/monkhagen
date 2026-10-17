const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mappedForwardStatus, processForwardWebhook } = require('../services/shippingWebhookService');

const ORDER = '10000000-0000-4000-8000-000000000001';

test('forward Shiprocket labels and shipment status IDs map to email milestones without return collisions', () => {
  for (const payload of [
    { shipment_status: 'SHIPPED' }, { shipment_status: 'PICKED UP' }, { shipment_status: 'IN TRANSIT' },
    { shipment_status: 'REACHED AT DESTINATION HUB' },
    { shipment_status_id: 6 }, { current_status_id: '18' }, { shipment_status_id: 42 }
  ]) assert.equal(mappedForwardStatus(payload), 'shipped');
  assert.equal(mappedForwardStatus({ shipment_status: 'OUT FOR DELIVERY' }), 'out_for_delivery');
  assert.equal(mappedForwardStatus({ shipment_status_id: 17 }), 'out_for_delivery');
  assert.equal(mappedForwardStatus({ shipment_status: 'DELIVERED' }), 'delivered');
  assert.equal(mappedForwardStatus({ shipment_status_id: 7 }), 'delivered');
  assert.equal(mappedForwardStatus({ shipment_status: 'RETURN DELIVERED', shipment_status_id: 48 }), null);
  assert.equal(mappedForwardStatus({ shipment_status: 'RTO DELIVERED', shipment_status_id: 10 }), null);
});

function databaseFixture(initialStatus = 'confirmed') {
  const eventIds = new Set();
  const state = { orderStatus: initialStatus, shippingStatus: 'created', deliveredAt: null, commits: 0 };
  const client = { release() {}, async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql === 'COMMIT') { state.commits += 1; return { rows: [] }; }
    if (sql.startsWith('SELECT s.*, o.order_status')) return { rows: [{ order_id: ORDER, order_status: state.orderStatus, shipping_status: state.shippingStatus }] };
    if (sql.startsWith('INSERT INTO shipment_webhook_events')) {
      if (eventIds.has(params[0])) return { rows: [] };
      eventIds.add(params[0]); return { rows: [{ event_id: params[0] }] };
    }
    if (sql.startsWith('UPDATE shipments')) { state.shippingStatus = params[6]; return { rows: [] }; }
    if (sql.includes("order_status = 'delivered'")) { state.orderStatus = 'delivered'; state.deliveredAt = new Date(); return { rows: [] }; }
    if (sql.includes("order_status = CASE")) { if (!['delivered','cancelled','returned'].includes(state.orderStatus)) state.orderStatus = 'shipped'; return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { state, database: { connect: async () => client } };
}

test('signed forward webhook advances shipment/order and emits each customer email once after commit', async () => {
  const fixture = databaseFixture();
  const notifications = [];
  const email = {
    orderShipped: async id => notifications.push(['shipped', id, fixture.state.commits]),
    orderOutForDelivery: async id => notifications.push(['out_for_delivery', id, fixture.state.commits]),
    orderDelivered: async id => notifications.push(['delivered', id, fixture.state.commits])
  };
  const headers = { 'x-api-key': 'test-webhook-secret' };
  const environment = { SHIPROCKET_WEBHOOK_SECRET: 'test-webhook-secret' };
  const shipped = { awb: 'AWB100', order_id: ORDER, shipment_status_id: 6, shipment_status: 'SHIPPED' };
  assert.equal((await processForwardWebhook(shipped, headers, fixture.database, environment, email)).duplicate, false);
  assert.equal((await processForwardWebhook(shipped, headers, fixture.database, environment, email)).duplicate, true);
  await processForwardWebhook({ awb: 'AWB100', order_id: ORDER, shipment_status_id: 17, shipment_status: 'OUT FOR DELIVERY' }, headers, fixture.database, environment, email);
  await processForwardWebhook({ awb: 'AWB100', order_id: ORDER, shipment_status_id: 7, shipment_status: 'DELIVERED' }, headers, fixture.database, environment, email);
  assert.equal(fixture.state.orderStatus, 'delivered');
  assert.ok(fixture.state.deliveredAt);
  assert.deepEqual(notifications.map(value => value[0]), ['shipped','out_for_delivery','delivered']);
  assert.ok(notifications.every(value => value[2] > 0));
});

test('forward webhook rejects an invalid callback secret before database access', async () => {
  const fixture = databaseFixture();
  await assert.rejects(processForwardWebhook({ awb: 'A', shipment_status_id: 7 }, { 'x-api-key': 'wrong' }, fixture.database,
    { SHIPROCKET_WEBHOOK_SECRET: 'right' }), error => error.code === 'WEBHOOK_UNAUTHORIZED');
  assert.equal(fixture.state.commits, 0);
});
