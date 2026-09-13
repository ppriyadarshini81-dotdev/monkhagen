const Shipment = require('../models/Shipment');
const shipping = require('./shippingService');

function startShippingWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const orderId of await Shipment.pending()) await shipping.processPendingOrder(orderId);
    } catch {
      console.error('Shipment queue could not be processed. It will be retried.');
    } finally { running = false; }
  }
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { startShippingWorker };
