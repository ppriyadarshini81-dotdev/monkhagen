const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturnTrackingService } = require('../services/returnTrackingService');
const { listCustomerReturns, listAdminReturns } = require('../services/returnService');

const ID = '10000000-0000-4000-8000-000000000001';
const USER = { id: 'customer', role: 'customer' };
function setup(overrides = {}) {
  let row = { id: ID, user_id: USER.id, return_number: 'R-TEST', status: 'return_created',
    shiprocket_return_order_id: 101, shiprocket_return_shipment_id: 202, return_awb: null,
    refund_amount: '1641.00', refund_status: 'pending', items: [], ...overrides.row };
  const statements = [], calls = [];
  const client = { release() {}, async query(sql, params) {
    statements.push({ sql, params });
    if (sql.startsWith('SELECT * FROM return_requests')) return { rows: [row] };
    if (sql.startsWith('UPDATE return_requests')) {
      row = { ...row, status: params[0], provider_status: params[1], pickup_status: params[5],
        return_awb: row.return_awb || params[2], received_at: params[0] === 'received' ? params[3] : row.received_at,
        pending_operation: params[0] === 'cancelled' ? null : row.pending_operation };
    }
    return { rows: [] };
  } };
  const database = { connect: async () => client, async query(sql, params) {
    if (sql.startsWith('SELECT id FROM return_requests')) return { rows: [{ id: ID }] };
    if (sql.startsWith('SELECT rr.id FROM return_requests')) return { rows: [{ id: ID }] };
    if (sql.startsWith('SELECT rr.*, o.order_number')) {
      if (params.length > 1) assert.equal(params[1], USER.id);
      return { rows: [row] };
    }
    throw new Error('Unexpected database query');
  } };
  const api = { async request(path, options) {
    assert.ok(!options?.method || options.method === 'GET');
    calls.push(path);
    if (overrides.request) return overrides.request(path);
    if (path === '/orders/show/101') return { data: { id: 101, channel_order_id: 'R-TEST', status: 'RETURN IN TRANSIT',
      status_code: 25, shipments: [{ id: 202, awb: 'RETURN-AWB' }] } };
    assert.equal(path, '/courier/track/awb/RETURN-AWB');
    return { tracking_data: { track_status: 1, shipment_status: 7,
      shipment_track: [{ awb_code: 'RETURN-AWB', shipment_id: 202, current_status: 'Delivered', delivered_date: '2026-10-20 14:30:00' }] } };
  } };
  let clock = 0;
  const service = createReturnTrackingService({ database, api, now: () => clock,
    forwardTracking: overrides.forwardTracking || (async () => { throw new Error('Unexpected outbound sync'); }) });
  return { service, database, calls, statements, getRow: () => row, setRow: changes => { row = { ...row, ...changes }; },
    advance: () => { clock += 60001; } };
}

test('return polling uses GET only, recovers the AWB and records warehouse receipt without changing money or inventory', async () => {
  const f = setup();
  const result = await f.service.refresh(f.getRow(), USER);
  assert.equal(result.unavailable, false);
  assert.equal(f.getRow().status, 'received');
  assert.equal(f.getRow().return_awb, 'RETURN-AWB');
  assert.equal(f.getRow().received_at, '2026-10-20T09:00:00.000Z');
  assert.equal(f.getRow().refund_amount, '1641.00');
  assert.equal(f.getRow().refund_status, 'pending');
  const update = f.statements.find(entry => entry.sql.startsWith('UPDATE'));
  assert.doesNotMatch(update.sql, /refund_amount|inventory|approved_at|refund_status/);
  assert.equal(f.calls.length, 2);
});

test('return polling checks ownership and refuses mismatched provider orders before saving', async () => {
  const f = setup({ request: async () => ({ data: { id: 101, channel_order_id: 'ANOTHER-RETURN', shipments: [{ id: 202 }] } }) });
  await assert.rejects(f.service.refresh(f.getRow(), { id: 'another-user', role: 'customer' }), error => error.status === 404);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.service.refresh(f.getRow(), USER)).unavailable, true);
  assert.equal(f.statements.length, 0);
  assert.equal(f.getRow().status, 'return_created');
});

test('return order and tracking shipment identifiers must match the saved mapping', async () => {
  for (const mismatch of ['shipment', 'awb']) {
    const f = setup({ request: async path => path.startsWith('/orders/show')
      ? { data: { id: 101, channel_order_id: 'R-TEST', status: 'RETURN INITIATED', shipments: [{ id: mismatch === 'shipment' ? 999 : 202, awb: 'RETURN-AWB' }] } }
      : { tracking_data: { shipment_track: [{ awb_code: 'OTHER-AWB' }] } } });
    assert.equal((await f.service.refresh(f.getRow(), USER)).unavailable, true);
    assert.equal(f.statements.length, 0);
  }
});

test('return status cannot move backwards or undo a concurrent inspection/refund', async () => {
  for (const status of ['in_transit', 'approved', 'refund_initiated']) {
    const f = setup({ row: { status: 'in_transit' }, request: async () => {
      f.setRow({ status });
      return { data: { id: 101, channel_order_id: 'R-TEST', status: 'RETURN INITIATED', status_code: 22, shipments: [{ id: 202 }] } };
    } });
    await f.service.refresh(f.getRow(), USER);
    assert.equal(f.getRow().status, status);
    assert.equal(f.statements.some(entry => entry.sql.startsWith('UPDATE')), false);
  }
});

test('return checks coalesce concurrent loads, cache for 60 seconds and do not create missing shipments', async () => {
  const f = setup({ request: async () => ({ data: { id: 101, channel_order_id: 'R-TEST', status: 'NEW', status_code: 21, shipments: [{ id: 202 }] } }) });
  await Promise.all([f.service.refresh(f.getRow(), USER), f.service.refresh(f.getRow(), USER)]);
  await f.service.refresh(f.getRow(), USER);
  assert.equal(f.calls.length, 1);
  f.advance(); await f.service.refresh(f.getRow(), USER);
  assert.equal(f.calls.length, 2);
  const noRemote = setup({ row: { shiprocket_return_order_id: null } });
  assert.equal((await noRemote.service.refresh(noRemote.getRow(), USER)).checked, false);
  assert.equal(noRemote.calls.length, 0);
  const creating = setup({ row: { pending_operation: 'create' } });
  assert.equal((await creating.service.refresh(creating.getRow(), USER)).checked, false);
  assert.equal(creating.calls.length, 0);
});

test('replacement delivery refresh runs independently of return inspection and provider failures', async () => {
  const outboundCalls = [];
  const f = setup({ row: { status: 'approved', outbound_order: { id: 'outbound-order', shiprocketOrderId: 303, status: 'shipped' } },
    forwardTracking: async (id, user) => { outboundCalls.push({ id, user }); } });
  await f.service.refresh(f.getRow(), USER);
  assert.deepEqual(outboundCalls, [{ id: 'outbound-order', user: USER }]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.getRow().status, 'approved');
});

test('customer return lists show freshly saved status and mark unavailable tracking without failing the page', async () => {
  const f = setup();
  const [result] = await listCustomerReturns(USER.id, f.database, {}, { tracking: f.service });
  assert.equal(result.status, 'received');
  assert.equal(result.returnAwb, 'RETURN-AWB');
  assert.equal(result.refundAmount, 1641);
  assert.equal(result.trackingSyncUnavailable, false);
  const offline = setup({ request: async () => { throw new Error('provider credentials must not be exposed'); } });
  const [saved] = await listCustomerReturns(USER.id, offline.database, {}, { tracking: offline.service });
  assert.equal(saved.status, 'return_created');
  assert.equal(saved.trackingSyncUnavailable, true);
  assert.ok(!JSON.stringify(saved).includes('credentials'));
});

test('admin returns tab uses the same sync and preserves the saved refund amount', async () => {
  const f = setup();
  const [result] = await listAdminReturns(f.database, {}, { tracking: f.service });
  assert.equal(result.status, 'received');
  assert.equal(result.returnAwb, 'RETURN-AWB');
  assert.equal(result.refundAmount, 1641);
});

test('confirmed cancellation clears only a pending cancellation, while provider failure does not hide the request', async () => {
  const f = setup({ row: { pending_operation: 'cancel' }, request: async () => ({ data: {
    id: 101, channel_order_id: 'R-TEST', status: 'CANCELLED', status_code: 27, shipments: [{ id: 202 }]
  } }) });
  await f.service.refresh(f.getRow(), USER);
  assert.equal(f.getRow().status, 'cancelled');
  assert.equal(f.getRow().pending_operation, null);
});

test('provider labels respect the saved status column lengths', async () => {
  const f = setup({ request: async () => ({ data: {
    id: 101, channel_order_id: 'R-TEST', status: 'RETURN PICKUP QUEUED ' + 'x'.repeat(120), status_code: 22, shipments: [{ id: 202 }]
  } }) });
  await f.service.refresh(f.getRow(), USER);
  assert.equal(f.getRow().status, 'pickup_scheduled');
  assert.equal(f.getRow().provider_status.length, 100);
  assert.equal(f.getRow().pickup_status.length, 50);
});

test('return sync executes its status UPDATE against PostgreSQL varchar columns without parameter type conflicts', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE return_requests (
    id UUID PRIMARY KEY, user_id TEXT, return_number TEXT, status VARCHAR(50),
    shiprocket_return_order_id BIGINT, shiprocket_return_shipment_id BIGINT, return_awb VARCHAR(100),
    provider_status VARCHAR(100), pickup_status VARCHAR(50), pending_operation VARCHAR(50),
    received_at TIMESTAMPTZ, operation_started_at TIMESTAMPTZ, inventory_restored_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  )`);
  await db.query(`INSERT INTO return_requests (id, user_id, return_number, status,
    shiprocket_return_order_id, shiprocket_return_shipment_id) VALUES ($1,$2,'R-TEST','return_created',101,202)`, [ID, USER.id]);
  const database = { connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
  for (const status of ['RETURN PENDING', 'CANCELLED']) {
    if (status === 'CANCELLED') await db.query("UPDATE return_requests SET pending_operation='cancel' WHERE id=$1", [ID]);
    const row = (await db.query('SELECT * FROM return_requests WHERE id=$1', [ID])).rows[0];
    const service = createReturnTrackingService({ database, api: { request: async () => ({ data: {
      id: 101, channel_order_id: 'R-TEST', status, shipments: [{ id: 202 }]
    } }) } });
    assert.equal((await service.refresh(row, USER)).unavailable, false);
    const saved = (await db.query('SELECT * FROM return_requests WHERE id=$1', [ID])).rows[0];
    assert.equal(saved.status, status === 'CANCELLED' ? 'cancelled' : 'return_created');
    assert.equal(saved.provider_status, status);
    if (status === 'CANCELLED') assert.equal(saved.pending_operation, null);
  }
});
