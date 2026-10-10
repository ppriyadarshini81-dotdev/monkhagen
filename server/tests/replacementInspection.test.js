const test = require('node:test');
const assert = require('node:assert/strict');
const { submitReplacementInspection, approveReturn, rejectReturn, inspectReturnItem } = require('../services/returnService');
const { shippingError } = require('../config/shiprocket');

const RETURN = '40000000-0000-4000-8000-000000000001';
const ORDER = '10000000-0000-4000-8000-000000000001';
const ITEM = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const FOREIGN = '20000000-0000-4000-8000-000000000003';
const PRODUCT = '60000000-0000-4000-8000-000000000001';
const OUTBOUND = '80000000-0000-4000-8000-000000000001';
const env = { SHIPROCKET_PICKUP_LOCATION: 'work', SHIPROCKET_PACKAGE_WEIGHT_KG: '0.5',
  SHIPROCKET_PACKAGE_LENGTH_CM: '20', SHIPROCKET_PACKAGE_BREADTH_CM: '15', SHIPROCKET_PACKAGE_HEIGHT_CM: '5' };
const decisions = (first = 'approved', second = 'rejected') => ({ items: [
  { itemId: ITEM, decision: first, reason: first === 'approved' ? 'Passed inspection' : 'Fabric damaged' },
  { itemId: OTHER, decision: second, reason: second === 'approved' ? 'Passed inspection' : 'Stain on returned product' }
] });

// Transaction-aware fixture: rollbacks must undo every product decision and stock change.
function fixture({ status = 'received', stock = 5, provider, finalizeFailure = false } = {}) {
  let state = { request: { id: RETURN, order_id: ORDER, return_number: 'R-123', request_type: 'replacement', status,
    pending_operation: null, refund_status: 'not_applicable' }, stock, originalStock: 1,
    items: [ITEM, OTHER].map(id => ({ id, inspection_status: 'pending', inspection_reason: null })), audit: [], movements: [], outboundOrder: null, shipment: null };
  const calls = [];
  let snapshot;
  const query = async (sql, values = []) => {
    sql = String(sql);
    const rows = data => ({ rows: data });
    if (sql === 'BEGIN') { snapshot = structuredClone(state); return rows([]); }
    if (sql === 'COMMIT') { snapshot = null; return rows([]); }
    if (sql === 'ROLLBACK') { if (snapshot) state = snapshot; snapshot = null; return rows([]); }
    if (sql.startsWith('SELECT * FROM return_requests') || sql.startsWith('SELECT rr.*, o.payment_method')) return rows([{ ...state.request }]);
    if (sql.startsWith('SELECT id FROM return_requests')) return rows([{ id: RETURN }]);
    if (sql.startsWith('SELECT id, inspection_status')) return rows(state.items.map(item => ({ ...item })));
    if (sql.startsWith('INSERT INTO orders')) {
      state.outboundOrder ||= { id: OUTBOUND, order_number: 'AS-123', order_type: state.items.some(item => item.inspection_status === 'approved') ? 'replacement' : 'rejected_return' };
      return rows([{ ...state.outboundOrder }]);
    }
    if (sql.startsWith('INSERT INTO order_addresses') || sql.startsWith('INSERT INTO order_items')) return rows([]);
    if (sql.startsWith('UPDATE orders SET fulfillment_hold_reason')) return rows([{ id: OUTBOUND }]);
    if (sql.startsWith('INSERT INTO shipments')) { state.shipment = { orderId: values[0], shiprocketOrderId: values[1] }; return rows([]); }
    if (sql.startsWith('UPDATE return_items')) {
      Object.assign(state.items.find(item => item.id === values[3]), { inspection_status: values[0], inspection_reason: values[1] });
      return rows([{ id: values[3] }]);
    }
    if (sql.startsWith('INSERT INTO return_request_audit')) { state.audit.push(values); return rows([]); }
    if (sql.startsWith('INSERT INTO inventory_movements')) { state.movements.push(values); return rows([{ id: 'movement' }]); }
    if (sql.startsWith('SELECT psd.id')) {
      const quantity = state.items.filter(item => item.inspection_status === 'approved').length;
      return rows(quantity ? [{ id: 'stock-L', product_id: PRODUCT, size_id: 'size-L', quantity }] : []);
    }
    if (sql.startsWith('SELECT ri.id')) return rows([]);
    if (sql.startsWith('UPDATE product_size_details SET stock_quantity = stock_quantity -')) {
      if (state.stock < values[0]) return rows([]);
      const before = state.stock; state.stock -= values[0];
      return rows([{ quantity_before: before, quantity_after: state.stock }]);
    }
    if (sql.startsWith('UPDATE product_size_details SET stock_quantity = stock_quantity +')) {
      const before = state.stock; state.stock += values[0];
      return rows([{ quantity_before: before, quantity_after: state.stock }]);
    }
    if (sql.startsWith('UPDATE product_size_details psd')) {
      if (finalizeFailure) throw new Error('database finalization failed');
      const before = state.originalStock; state.originalStock += values[0];
      return rows([{ id: 'stock-M', product_id: PRODUCT, size_id: 'size-M', quantity_before: before, quantity_after: state.originalStock }]);
    }
    if (sql.startsWith("UPDATE return_requests SET pending_operation = 'replacement_create'")) { state.request.pending_operation = 'replacement_create'; return rows([]); }
    if (sql.startsWith('UPDATE return_requests SET shiprocket_outbound_order_id')) {
      Object.assign(state.request, { shiprocket_outbound_order_id: values[0], shiprocket_outbound_shipment_id: values[1],
        status: 'approved', pending_operation: null, outbound_status: 'created' }); return rows([]);
    }
    if (sql.startsWith('UPDATE return_requests SET last_error_code')) {
      Object.assign(state.request, { last_error_code: 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED',
        shiprocket_outbound_order_id: values[1], shiprocket_outbound_shipment_id: values[2] }); return rows([]);
    }
    if (sql.startsWith('UPDATE return_requests SET pending_operation = NULL')) { state.request.pending_operation = null; return rows([]); }
    if (sql.startsWith('SELECT rr.return_number')) return rows(state.items.map(item => ({ ...item,
      return_item_id: item.id, return_number: 'R-123', product_id: PRODUCT, product_name: 'Original tee',
      outbound_order_id: state.outboundOrder?.id,
      sku: 'TEE-M-BLACK', replacement_sku: 'TEE-L-BLACK', size: 'M', replacement_size: 'L', quantity: 1, unit_price: '100.00',
      full_name: 'Buyer Name', customer_email: 'buyer@example.com', phone: '9876543210',
      address_line1: 'Customer Home', city: 'Mumbai', state: 'Maharashtra', postal_code: '400001' })));
    if (sql.startsWith('SELECT rr.*, o.order_number')) return rows([{ ...state.request, items: state.items.map(item => ({
      id: item.id, inspectionStatus: item.inspection_status, inspectionReason: item.inspection_reason })) }]);
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const database = { query, connect: async () => ({ query, release() {} }) };
  const api = { request: async (path, options) => {
    if (path === '/settings/company/pickup') return { data: { shipping_address: [{ pickup_location: 'work',
      name: 'Monk Hagen', address: 'Warehouse', city: 'Delhi', state: 'Delhi', country: 'India',
      pin_code: '110001', email: 'returns@example.com', phone: '9876543210' }] } };
    assert.equal(path, '/orders/create/adhoc');
    calls.push(options.body);
    return provider ? provider(options.body) : { order_id: 11, shipment_id: 22 };
  } };
  return { database, api, env, calls, get state() { return state; } };
}

test('mixed inspection submits one warehouse-to-customer order, replaces approved sizes and returns rejected originals', async () => {
  const f = fixture();
  const result = await submitReplacementInspection(RETURN, decisions(), 'admin', f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].pickup_location, 'work');
  assert.equal(f.calls[0].billing_address, 'Customer Home');
  assert.equal(f.calls[0].payment_method, 'Prepaid');
  assert.equal(f.calls[0].order_id, OUTBOUND);
  assert.equal(f.state.outboundOrder.order_type, 'replacement');
  assert.equal(f.state.shipment.orderId, OUTBOUND);
  assert.deepEqual(f.calls[0].order_items.map(item => item.sku), ['TEE-L-BLACK', 'TEE-M-BLACK']);
  assert.equal(f.state.stock, 4);
  assert.equal(f.state.originalStock, 2);
  assert.equal(result.items[1].inspectionStatus, 'rejected');
  assert.equal(result.items[1].inspectionReason, 'Stain on returned product');
  assert.equal(result.shiprocketOutboundOrderId, 11);
  await submitReplacementInspection(RETURN, decisions(), 'admin', f);
  assert.equal(f.calls.length, 1, 'repeated submission must not create another order');
  assert.equal(f.state.stock, 4);
});

test('all approved products replace their sizes in one outbound order', async () => {
  const f = fixture(); await submitReplacementInspection(RETURN, decisions('approved', 'approved'), 'admin', f);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].order_items.length, 2);
  assert.ok(f.calls[0].order_items.every(item => item.name.includes('replacement size L')));
  assert.equal(f.state.stock, 3); assert.equal(f.state.originalStock, 3);
});

test('all rejected products still ship originals back, with reasons and no sellable stock changes', async () => {
  const f = fixture(); const result = await submitReplacementInspection(RETURN, decisions('rejected', 'rejected'), 'admin', f);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].order_items.every(item => item.name.includes('returned item')));
  assert.ok(result.items.every(item => item.inspectionStatus === 'rejected' && item.inspectionReason));
  assert.equal(f.state.stock, 5); assert.equal(f.state.originalStock, 1);
  assert.equal(f.state.outboundOrder.order_type, 'rejected_return');
});

test('incomplete, duplicate, foreign product and reasonless submissions cannot save partial decisions or call Shiprocket', async () => {
  const inputs = [{ items: [decisions().items[0]] }, { items: [...decisions().items, decisions().items[0]] },
    { items: [decisions().items[0], { ...decisions().items[1], itemId: FOREIGN }] },
    { items: [decisions().items[0], { ...decisions().items[1], reason: ' ' }] }];
  for (const input of inputs) {
    const f = fixture(); await assert.rejects(submitReplacementInspection(RETURN, input, 'admin', f));
    assert.equal(f.calls.length, 0); assert.ok(f.state.items.every(item => item.inspection_status === 'pending'));
    assert.equal(f.state.stock, 5); assert.equal(f.state.audit.length, 0);
  }
});

test('inspection cannot submit before warehouse receipt, or oversell replacement stock', async () => {
  for (const options of [{ status: 'return_created' }, { status: 'in_transit' }, { stock: 0 }]) {
    const f = fixture(options); await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f));
    assert.equal(f.calls.length, 0); assert.ok(f.state.items.every(item => item.inspection_status === 'pending'));
  }
});

test('definitive provider failure releases stock and allows a retry with saved inspection decisions', async () => {
  let fail = true;
  const f = fixture({ provider: () => { if (fail) throw shippingError(502, 'SHIPROCKET_VALIDATION', 'Rejected', false); return { order_id: 11, shipment_id: 22 }; } });
  await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f));
  assert.equal(f.state.stock, 5); assert.equal(f.state.request.pending_operation, null);
  assert.equal(f.state.items[0].inspection_status, 'approved');
  fail = false; await submitReplacementInspection(RETURN, { items: [] }, 'admin', f);
  assert.equal(f.state.stock, 4); assert.equal(f.state.originalStock, 2);
});

test('uncertain provider response retains reservation and blocks duplicate submissions', async () => {
  for (const provider of [() => { throw shippingError(504, 'SHIPROCKET_TIMEOUT', 'Timeout', true); }, () => ({})]) {
    const f = fixture({ provider });
    await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f), e => e.code === 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED');
    assert.equal(f.state.stock, 4); assert.equal(f.state.request.pending_operation, 'replacement_create');
    await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f)); assert.equal(f.calls.length, 1);
  }
});

test('provider success followed by database failure preserves remote IDs for reconciliation', async () => {
  const f = fixture({ finalizeFailure: true });
  await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f), e => e.code === 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED');
  assert.equal(f.state.request.shiprocket_outbound_order_id, 11); assert.equal(f.state.request.shiprocket_outbound_shipment_id, 22);
  assert.equal(f.state.request.pending_operation, 'replacement_create'); assert.equal(f.state.originalStock, 1);
  await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f)); assert.equal(f.calls.length, 1);
});

test('whole-request approve/reject cannot bypass replacement inspection', async () => {
  const f = fixture();
  await assert.rejects(approveReturn(RETURN, f.database), e => e.code === 'RETURN_ITEM_INSPECTION_REQUIRED');
  await assert.rejects(rejectReturn(RETURN, { database: f.database }), e => e.code === 'RETURN_ITEM_INSPECTION_REQUIRED');
  assert.equal(f.state.request.status, 'received');
});

test('a second submission and individual inspection cannot race an active outbound shipment', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture({ provider: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const first = submitReplacementInspection(RETURN, decisions(), 'admin', f);
  await started;
  await assert.rejects(submitReplacementInspection(RETURN, decisions(), 'admin', f), e => e.code === 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED');
  await assert.rejects(inspectReturnItem(RETURN, OTHER, { decision: 'approved' }, 'admin', f.database), e => e.code === 'REPLACEMENT_SHIPMENT_RECONCILIATION_REQUIRED');
  release({ order_id: 11, shipment_id: 22 }); await first;
  assert.equal(f.calls.length, 1); assert.equal(f.state.stock, 4);
});
