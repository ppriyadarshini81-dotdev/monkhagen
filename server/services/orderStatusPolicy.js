const NEXT = {
  placed: ['confirmed','processing','cancelled'], confirmed: ['processing','shipped','cancelled'],
  processing: ['shipped','cancelled'], shipped: ['delivered'], delivered: ['return_requested'],
  return_requested: ['delivered','returned'], returned: [], cancelled: []
};
function denied(message) { throw Object.assign(new Error(message), { status: 409 }); }
function validateTransition(order, status) {
  if (typeof status !== 'string' || !Object.hasOwn(NEXT, status)) throw Object.assign(new Error('Invalid order status.'), { status: 400 });
  if (order.order_status === status) return;
  if (!(NEXT[order.order_status] || []).includes(status)) denied('This order status transition is not permitted.');
  if (['confirmed','processing','shipped','delivered'].includes(status)) {
    if (order.fulfillment_hold_reason) denied('Resolve this order’s inventory or payment hold before changing its fulfillment status.');
    const prepaid = order.payment_method === 'razorpay' && order.payment_status === 'paid' &&
      order.razorpay_order_id && order.razorpay_payment_id && order.paid_at;
    const cod = order.payment_method === 'cod' && ['pending','paid'].includes(order.payment_status);
    if (!prepaid && !cod) denied('A valid payment is required before fulfillment.');
    if (!order.inventory_deducted_at) denied('Inventory allocation must be verified before fulfillment.');
  }
}
module.exports = { validateTransition, NEXT };
