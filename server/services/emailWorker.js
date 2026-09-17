const { pool } = require('../config/db');
const { getTransporter } = require('../config/mailer');
const { sendOrderConfirmation } = require('./orderConfirmationEmail');

const POLL_INTERVAL_MS = 60 * 1000;

async function sendPendingConfirmations({ limit = 20 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid email queue batch size.');
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
     LIMIT $1`, [limit]
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
        code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'EMAIL_QUEUE_FAILED'
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
