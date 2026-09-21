const { pool } = require('../config/db');
const { releaseExpiredReservations } = require('./inventoryService');
let running = false;
async function runMaintenance(database = pool) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const released = await releaseExpiredReservations(client);
    await client.query(`DELETE FROM security_rate_limits WHERE key_hash IN
      (SELECT key_hash FROM security_rate_limits WHERE reset_at < NOW() - INTERVAL '1 day' LIMIT 1000)`);
    await client.query(`DELETE FROM operation_leases WHERE lock_key IN
      (SELECT lock_key FROM operation_leases WHERE expires_at < NOW() - INTERVAL '1 day' LIMIT 1000)`);
    const analyticsEvents = await client.query(`DELETE FROM analytics_events WHERE id IN
      (SELECT id FROM analytics_events WHERE occurred_at < NOW() - INTERVAL '400 days' LIMIT 5000)`);
    const analyticsSessions = await client.query(`DELETE FROM analytics_sessions WHERE id IN
      (SELECT s.id FROM analytics_sessions s WHERE s.last_activity_at < NOW() - INTERVAL '400 days'
        AND NOT EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id) LIMIT 1000)`);
    await client.query('COMMIT');
    return { expiredReservationsChecked: released,
      analyticsRowsRemoved: analyticsEvents.rowCount + analyticsSessions.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
function startMaintenanceWorker() {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runMaintenance(); }
    catch { console.warn('Security maintenance will retry; no order or credential details logged.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { runMaintenance, startMaintenanceWorker };
