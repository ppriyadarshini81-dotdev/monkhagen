const test = require('node:test');
const assert = require('node:assert/strict');
const { adminCategory, outboundStage } = require('../services/returnWorkflow');
const { assertFulfillmentSafe } = require('../services/shippingMapping');
const { evaluateEligibility, listAdminReturns } = require('../services/returnService');
const { eligible } = require('../services/orderCancellationService');

test('return tabs keep waiting requests, inspection/refund actions and action-free tasks distinct', () => {
  assert.equal(adminCategory({ status: 'requested', defect_photo_evidence: {}, defect_photo_review: null }), 'inspection_required');
  for (const status of ['requested', 'return_created', 'shiprocket_failed', 'pickup_scheduled', 'picked_up', 'in_transit', 'pickup_failed'])
    assert.equal(adminCategory({ status }), 'requested');
  assert.equal(adminCategory({ status: 'received' }), 'inspection_required');
  assert.equal(adminCategory({ status: 'approved', payment_method: 'cod', refund_destination_status: 'PROCESSING' }), 'inspection_required');
  assert.equal(adminCategory({ status: 'approved', pending_operation: 'refund' }), 'inspection_required');
  assert.equal(adminCategory({ status: 'refund_initiated' }), 'completed');
  assert.equal(adminCategory({ status: 'approved', request_type: 'return', refund_status: 'not_applicable', refund_amount: 0 }), 'completed');
  for (const status of ['refunded', 'cancelled', 'rejected']) assert.equal(adminCategory({ status }), 'completed');
});

test('outbound orders stay actionable until courier pickup is scheduled and return to attention after failure', () => {
  const request = order => ({ status: 'approved', outbound_order: order });
  assert.equal(adminCategory(request({ shippingStatus: 'created' })), 'outbound');
  assert.equal(adminCategory(request({ awb: 'AWB1', shippingStatus: 'awb_assigned' })), 'outbound');
  assert.equal(adminCategory(request({ awb: 'AWB1', pickupStatus: 'scheduled' })), 'completed');
  assert.equal(adminCategory(request({ status: 'delivered', shippingStatus: 'delivered' })), 'completed');
  assert.equal(adminCategory(request({ shippingStatus: 'failed', pickupStatus: 'scheduled' })), 'outbound');
  assert.equal(adminCategory(request({ status: 'confirmed', holdReason: 'AFTER_SALES_PROVIDER_PENDING' })), 'outbound');
});

test('customer outbound stages cover order creation, courier, scheduling, transit and delivery', () => {
  const stages = [{}, { awb: 'AWB1' }, { pickupStatus: 'scheduled' }, { status: 'shipped' },
    { trackingStatus: 'OUT FOR DELIVERY' }, { status: 'delivered', trackingStatus: 'IN TRANSIT' }];
  assert.deepEqual(stages.map(outboundStage), [0, 1, 2, 3, 4, 5]);
});

test('zero-charge after-sales shipping requires a completed linked inspection and cannot bypass a hold', () => {
  for (const order_type of ['replacement', 'rejected_return']) {
    const order = { order_type, source_order_id: 'original', return_request_id: 'return', total_amount: 0,
      after_sales_return_status: 'approved', order_status: 'confirmed' };
    assert.doesNotThrow(() => assertFulfillmentSafe(order));
    for (const changes of [{ total_amount: 100 }, { return_request_id: null }, { after_sales_return_status: 'received' },
      { after_sales_pending_operation: 'replacement_create' }, { fulfillment_hold_reason: 'AFTER_SALES_PROVIDER_PENDING' }])
      assert.throws(() => assertFulfillmentSafe({ ...order, ...changes }));
    assert.equal(evaluateEligibility(order, []).reason, 'AFTER_SALES_ORDER');
    assert.equal(eligible(order, {}).reason, 'AFTER_SALES_ORDER');
  }
});

test('admin tab filters are validated before queries and apply before pagination', async () => {
  const queries = [];
  const database = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
  await assert.rejects(listAdminReturns(database, { tab: 'not-a-tab' }), e => e.status === 400);
  assert.equal(queries.length, 0);
  await listAdminReturns(database, { tab: 'inspection_required', limit: 11, offset: 10 });
  assert.deepEqual(queries[0].params, [11, 10, 'inspection_required']);
  assert.ok(queries[0].sql.indexOf('WHERE') < queries[0].sql.indexOf('LIMIT'));
});
