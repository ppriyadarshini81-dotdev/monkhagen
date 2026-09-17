require('dotenv').config({ quiet: true });
const { pool } = require('./config/db');
const { runMaintenance } = require('./services/securityMaintenance');
void runMaintenance().then(result => console.log('Security maintenance complete.', result))
  .catch(() => { console.error('Security maintenance failed; no database details logged.'); process.exitCode = 1; })
  .finally(() => pool.end());
