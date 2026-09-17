const Razorpay = require('razorpay');

let instance;

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay is not configured. Add the test-mode credentials to the backend environment.');
    error.status = 503;
    throw error;
  }

  if (!instance) {
    instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return { razorpay: instance, keyId };
}

module.exports = { getRazorpay };
