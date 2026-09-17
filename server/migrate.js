require('dotenv').config({ quiet: true });
const { connectDB, pool } = require('./config/db');
void connectDB({ migrate: true }).catch(() => {
  console.error('Migration failed; internal details suppressed.'); process.exitCode = 1;
}).finally(() => pool.end());
