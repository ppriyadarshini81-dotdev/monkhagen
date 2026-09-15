const { pool } = require('../config/db');
const { getTransporter } = require('../config/mailer');
const { sendOrderConfirmation } = require('./orderConfirmationEmail');

const POLL_INTERVAL_MS = 60 * 1000;

async function sendPendingConfirmations() {
  // Avoid querying or logging one error per order while SMTP is intentionally absent.
  try {
    getTransporter();
  } catch (error) {
    if (error.status === 503) return 0;
    throw error;
  }

  const { rows } = await pool.query(
    `SELECT id
     FROM orders
     WHERE payment_status = 'paid' AND confirmation_email_sent_at IS NULL
     ORDER BY paid_at NULLS LAST, created_at
     LIMIT 20`
  );

  let sent = 0;
  for (const order of rows) {
    if (await sendOrderConfirmation(order.id)) sent += 1;
  }
  return sent;
}

function startEmailWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const sent = await sendPendingConfirmations();
      if (sent > 0) console.log(`Order confirmation emails sent: ${sent}`);
    } catch (error) {
      console.error('Order confirmation queue could not be processed:', {
        code: error.code || null,
        message: error.message || 'Email delivery failed.'
      });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { sendPendingConfirmations, startEmailWorker };
