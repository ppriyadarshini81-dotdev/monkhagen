require('dotenv').config({ quiet: true });
const { connectDB, pool } = require('./config/db');
void connectDB({ migrate: true }).finally(() => pool.end());
