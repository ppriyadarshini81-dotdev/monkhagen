const Shipment = require('../models/Shipment');
const shipping = require('./shippingService');
async function processShippingQueue({ limit = 10 } = {}) {
  let processed = 0;
  for (const orderId of await Shipment.pending(limit)) { await shipping.processPendingOrder(orderId); processed++; }
  return processed;
}

function startShippingWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await processShippingQueue();
    } catch {
      console.error('Shipment queue could not be processed. It will be retried.');
    } finally { running = false; }
  }
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { startShippingWorker, processShippingQueue };
