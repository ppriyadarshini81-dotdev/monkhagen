const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const reports = require('../services/analyticsReportService');
const analytics = require('../services/analyticsService');

test('analytics dashboard migration is additive and installs privacy/performance fields', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '016_analytics_dashboard.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS active_seconds/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_internal/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS metadata JSONB/i);
  assert.match(sql, /FRONTEND_ERROR/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});

test('frontend error metadata is sanitized and cart metadata is bounded', () => {
  const error = analytics.cleanMetadata({ type: 'FRONTEND_ERROR', metadata: {
    message: 'failed https://example.test/path?token=secret abcdefghijklmnopqrstuvwxyz1234567890',
    category: 'window error'
  }});
  assert.equal(error.category, 'window error');
  assert.doesNotMatch(error.message, /example\.test|abcdefghijklmnopqrstuvwxyz/);
  assert.deepEqual(analytics.cleanMetadata({ type: 'ADD_TO_CART', metadata: { quantity: 2, estimatedValue: 1499.45 } }),
    { quantity: 2, estimatedValue: 1499.45 });
  assert.deepEqual(analytics.cleanMetadata({ type: 'ADD_TO_CART', metadata: { quantity: 1000, estimatedValue: -1 } }), {});
});

test('active-time heartbeat validates bounds and records exit path', async () => {
  const calls = [];
  const database = { query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1, rows: [] }; } };
  const id = '11111111-1111-4111-8111-111111111111';
  const visitor = '22222222-2222-4222-8222-222222222222';
  await analytics.touchSession({ sessionId: id, visitorId: visitor, activeSeconds: 30, exitPath: '/products?private=yes' }, database);
  assert.match(calls[0].sql, /active_seconds = active_seconds \+ \$5/);
  assert.equal(calls[0].values[4], 30);
  assert.equal(calls[0].values[5], '/products');
  await assert.rejects(() => analytics.touchSession({ sessionId: id, visitorId: visitor, activeSeconds: 61 }, database), /duration/);
});

test('overview KPI catalogue documents ledger, privacy, returns and health metrics', () => {
  for (const key of ['visitors','averageSessionSeconds','grossRevenue','refunds','revenue','returnRequests','frontendErrors']) {
    assert.equal(typeof reports.KPI_DEFINITIONS[key], 'string');
    assert.ok(reports.KPI_DEFINITIONS[key].length > 20);
  }
  assert.match(reports.KPI_DEFINITIONS.revenue, /ledger/i);
});

test('aggregate uses ledger credits minus completed refunds and safe zero denominators', async () => {
  let sessionQuery = '';
  const database = { query: async sql => {
    if (sql.includes('FROM visitors')) sessionQuery = sql;
    if (sql.includes('FROM visitors')) return { rows: [{ sessions: 2, visitors: 2, logged_in_visitors: 1,
      anonymous_visitors: 1, returning_visitors: 1, page_views: 6, product_views: 3, average_session_seconds: 45 }] };
    if (sql.includes('GROUP BY e.event_type')) return { rows: [{ event_type: 'ADD_TO_CART', count: 2 }] };
    if (sql.includes('FROM orders WHERE')) return { rows: [{ successful_orders: 2, revenue: 99999,
      pending_payments: 0, abandoned_checkouts: 0 }] };
    if (sql.includes('FROM payment_attempts')) return { rows: [{ attempts: 0, successful: 0, failed: 0 }] };
    if (sql.includes('FROM activity')) return { rows: [{ carts_used: 0, abandoned: 0 }] };
    if (sql.includes('FROM financial_transactions')) return { rows: [{ gross_revenue: 1000, refunds: 200, pending_refunds: 50 }] };
    if (sql.includes('FROM return_requests')) return { rows: [{ requested: 1, completed: 0 }] };
    if (sql.includes('WITH login_users AS')) return { rows: [{ unique_users_logged_in: 1, repeat_login_users: 0,
      unique_product_viewers: 2, products_viewed: 1, add_to_cart_visitors: 1, affected_error_sessions: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const result = await reports.aggregate('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', database);
  assert.equal(result.grossRevenue, 1000);
  assert.equal(result.refunds, 200);
  assert.equal(result.revenue, 800);
  assert.equal(result.averageOrderValue, 400);
  assert.equal(result.paymentFailureRate, 0);
  assert.equal(result.cartAbandonmentRate, 0);
  assert.match(sessionQuery, /CASE WHEN user_id IS NULL THEN 'visitor:'/);
  assert.match(sessionQuery, /ELSE 'user:'\|\|user_id::text END AS identity/);
  assert.match(sessionQuery, /old\.user_id IS NULL THEN 'visitor:'/);
});

test('period comparisons use equal inclusive business-day windows', () => {
  const period = reports.resolvePeriod({ range: '30d' }, new Date('2026-10-02T08:00:00Z'));
  assert.equal(period.timezone, 'Asia/Kolkata');
  assert.equal(period.startDate, '2026-09-03');
  assert.equal(period.endDate, '2026-10-02');
  assert.equal(period.lengthDays, 30);
});
