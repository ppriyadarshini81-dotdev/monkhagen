const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTransition } = require('../services/orderStatusPolicy');
const paid = { order_status: 'confirmed', payment_method: 'razorpay', payment_status: 'paid',
  razorpay_order_id: 'order_mock', razorpay_payment_id: 'pay_mock', paid_at: new Date(), inventory_deducted_at: new Date() };
test('order state machine prevents skips, reversals and resurrection of terminal orders', () => {
  for (const [from, to] of [['placed','delivered'],['shipped','cancelled'],['delivered','confirmed'],['cancelled','confirmed'],['returned','processing']]) {
    assert.throws(() => validateTransition({ ...paid, order_status: from }, to), error => error.status === 409);
  }
  assert.throws(() => validateTransition(paid, 'invalid'), error => error.status === 400);
  assert.doesNotThrow(() => validateTransition(paid, 'processing'));
  assert.doesNotThrow(() => validateTransition(paid, 'confirmed'));
});
test('fulfillment transitions require captured payment, allocated inventory and no refund/cancellation hold', () => {
  for (const changes of [{ payment_status: 'pending' }, { payment_status: 'refunded' }, { payment_status: 'partially_refunded' },
    { inventory_deducted_at: null }, { fulfillment_hold_reason: 'ORDER_REFUND_REVIEW_REQUIRED' }, { razorpay_payment_id: null }]) {
    assert.throws(() => validateTransition({ ...paid, ...changes }, 'shipped'), error => error.status === 409);
  }
  assert.doesNotThrow(() => validateTransition({ ...paid, payment_method: 'cod', payment_status: 'pending' }, 'processing'));
});
