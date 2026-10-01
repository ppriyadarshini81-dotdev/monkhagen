const emails = require('./transactionalEmailService');

const POLL_INTERVAL_MS = 60 * 1000;

async function sendPendingConfirmations({ limit = 20 } = {}) {
  const result = await emails.processPendingEmails({ limit });
  return result.sent;
}

function startEmailWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await emails.processPendingEmails({ limit: 20 });
      if (result.sent > 0) console.log(`Transactional emails sent: ${result.sent}`);
    } catch (error) {
      console.error('Transactional email queue could not be processed:', {
        code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'EMAIL_QUEUE_FAILED'
      });
    } finally { running = false; }
  }
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { sendPendingConfirmations, startEmailWorker };
