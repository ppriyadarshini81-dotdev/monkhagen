const test = require('node:test');
const assert = require('node:assert/strict');
const { nonCancellable, createOrderCancellationService } = require('../services/orderCancellationService');

test('courier-handover statuses are never cancellable', () => {
  for (const status of ['shipped', 'dispatched', 'picked up', 'in transit', 'out for delivery', 'delivered']) {
    assert.equal(nonCancellable(status), true, status);
  }
  assert.equal(nonCancellable('awb_assigned'), false);
  assert.equal(nonCancellable('pickup_scheduled'), false);
});

test('eligibility blocks in-progress, completed, and courier handover states', () => {
  const service = createOrderCancellationService({ database: {} });
  assert.equal(service.eligible({ order_status: 'confirmed' }, { shipping_status: 'created' }, null).eligible, true);
  assert.equal(service.eligible({ order_status: 'confirmed' }, { pending_operation: 'create' }, null).reason, 'SHIPPING_IN_PROGRESS');
  assert.equal(service.eligible({ order_status: 'confirmed' }, { tracking_status: 'In Transit' }, null).reason, 'SHIPMENT_HANDED_OVER');
  assert.equal(service.eligible({ order_status: 'cancelled' }, null, null).reason, 'ALREADY_CANCELLED');
  assert.equal(service.eligible({ order_status: 'confirmed' }, null, { status: 'cancelling' }).reason, 'CANCELLATION_IN_PROGRESS');
});
