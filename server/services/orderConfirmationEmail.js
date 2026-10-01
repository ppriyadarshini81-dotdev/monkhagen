// Compatibility boundary retained for payment/order callers and tests. The
// centralized service creates separate idempotent customer and admin events.
async function sendOrderConfirmation(orderId) {
  return require('./transactionalEmailService').orderConfirmed(orderId);
}

module.exports = { sendOrderConfirmation };
