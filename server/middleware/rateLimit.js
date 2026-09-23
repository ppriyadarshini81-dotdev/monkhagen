const crypto = require('node:crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { pool } = require('../config/db');

class PostgresRateLimitStore {
  constructor(scope, database = pool) { this.scope = scope; this.database = database; this.localKeys = false; }
  init({ windowMs }) { this.windowMs = windowMs; }
  key(key) { return crypto.createHash('sha256').update(`${this.scope}:${key}`).digest('hex'); }
  async increment(key) {
    try {
      const { rows } = await this.database.query(`
        INSERT INTO security_rate_limits (key_hash, hits, reset_at)
        VALUES ($1, 1, clock_timestamp() + $2::double precision * INTERVAL '1 millisecond')
        ON CONFLICT (key_hash) DO UPDATE SET
          hits = CASE WHEN security_rate_limits.reset_at <= clock_timestamp() THEN 1 ELSE security_rate_limits.hits + 1 END,
          reset_at = CASE WHEN security_rate_limits.reset_at <= clock_timestamp()
            THEN clock_timestamp() + $2::double precision * INTERVAL '1 millisecond' ELSE security_rate_limits.reset_at END
        RETURNING hits, reset_at`, [this.key(key), this.windowMs]);
      return { totalHits: Number(rows[0].hits), resetTime: new Date(rows[0].reset_at) };
    } catch { throw Object.assign(new Error('Request protection is temporarily unavailable. Please try again later.'), { status: 503 }); }
  }
  async decrement(key) {
    await this.database.query('UPDATE security_rate_limits SET hits = GREATEST(0, hits - 1) WHERE key_hash = $1', [this.key(key)]);
  }
  async resetKey(key) { await this.database.query('DELETE FROM security_rate_limits WHERE key_hash = $1', [this.key(key)]); }
}

function createLimiter(scope, { limit, windowMs, authenticated = false }) {
  return rateLimit({
    windowMs, limit, store: new PostgresRateLimitStore(scope),
    keyGenerator: req => authenticated && req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip),
    standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: false,
    message: { message: 'Too many requests. Please try again later.' }
  });
}

const adminLimiter = createLimiter('admin', { limit: 120, windowMs: 60000, authenticated: true });
const checkoutLimiter = createLimiter('checkout', { limit: 5, windowMs: 15 * 60000, authenticated: true });
const verifyLimiter = createLimiter('payment-verify', { limit: 30, windowMs: 5 * 60000, authenticated: true });
const returnLimiter = createLimiter('returns', { limit: 10, windowMs: 15 * 60000, authenticated: true });
const analyticsLimiter = createLimiter('analytics', { limit: 180, windowMs: 60000 });
module.exports = { PostgresRateLimitStore, createLimiter, adminLimiter, checkoutLimiter, verifyLimiter, returnLimiter, analyticsLimiter };
