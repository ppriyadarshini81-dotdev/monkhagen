require('dotenv').config({ quiet: true });
const { pool } = require('./config/db');

// Read-only diagnostics: never initializes schema, migrates, or prints a URL,
// database account, customer record, token, password or provider response.
(async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT NOW() AS checked_at,
      current_database() = $1 AS correct_database,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema = $2 AND table_name = $3 AND column_name = $4)
        AS session_revocation_ready,
      to_regclass('public.analytics_sessions') IS NOT NULL
        AND to_regclass('public.analytics_events') IS NOT NULL
        AND to_regclass('public.payment_attempts') IS NOT NULL
        AS analytics_ready`, ['monkhagen', 'public', 'users', 'session_version']);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ connected: true, ...rows[0] }));
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Read-only database check failed; internal details suppressed.');
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
})();
