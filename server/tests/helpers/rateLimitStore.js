// Route tests replace only the store's I/O, never disable application limiters.
// No production database is contacted by these test requests.
const { PostgresRateLimitStore } = require('../../middleware/rateLimit');
const counters = new Map();
// Also replace Firebase session lookups: route tests never call live services.
require('../../config/firebaseAdmin').getAuth = () => ({ getUser: async uid => ({ uid,
  disabled: false, emailVerified: true, tokensValidAfterTime: '1970-01-01T00:00:00Z' }) });
PostgresRateLimitStore.prototype.increment = async function(key) {
  const hash = this.key(key);
  let counter = counters.get(hash);
  if (!counter || counter.resetTime.getTime() <= Date.now()) {
    counter = { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    counters.set(hash, counter);
  }
  counter.totalHits++;
  return { ...counter };
};
