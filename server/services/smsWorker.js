const sms = require('./transactionalSmsService');

const POLL_INTERVAL_MS = 60 * 1000;

async function sendPendingSms({ limit = 20 } = {}) {
  const result = await sms.processPendingSms({ limit });
  return result.sent;
}

function startSmsWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await sms.processPendingSms({ limit: 20 });
      if (result.sent > 0) console.log(`Transactional SMS sent: ${result.sent}`);
    } catch (error) {
      console.error('Transactional SMS queue could not be processed:', {
        code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'SMS_QUEUE_FAILED'
      });
    } finally { running = false; }
  }
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { sendPendingSms, startSmsWorker };
