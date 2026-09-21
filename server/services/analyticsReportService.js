const { pool } = require('../config/db');

const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const INDIA_OFFSET = '+05:30';
const RANGE_VALUES = new Set(['today', 'yesterday', '7d', '30d', 'this_month', 'custom']);

function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
function todayInBusinessZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function startOfMonth(value) { return `${value.slice(0, 7)}-01`; }
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isoDate(new Date(`${value}T00:00:00Z`)) === value;
}
function midnightUtc(value) { return new Date(`${value}T00:00:00${INDIA_OFFSET}`).toISOString(); }

function resolvePeriod(query = {}, now = new Date()) {
  const range = query.range || '7d';
  if (!RANGE_VALUES.has(range)) throw httpError(400, 'Invalid analytics date range.');
  const today = todayInBusinessZone(now);
  let startDate;
  let endDate = today;
  let label;
  if (range === 'today') { startDate = today; label = 'Today'; }
  else if (range === 'yesterday') { startDate = addDays(today, -1); endDate = startDate; label = 'Yesterday'; }
  else if (range === '7d') { startDate = addDays(today, -6); label = 'Last 7 days'; }
  else if (range === '30d') { startDate = addDays(today, -29); label = 'Last 30 days'; }
  else if (range === 'this_month') { startDate = startOfMonth(today); label = 'This month'; }
  else {
    if (!validDate(query.start) || !validDate(query.end) || query.start > query.end) {
      throw httpError(400, 'A valid custom start and end date are required.');
    }
    const days = Math.round((new Date(`${query.end}T00:00:00Z`) - new Date(`${query.start}T00:00:00Z`)) / 86400000) + 1;
    if (days > 366) throw httpError(400, 'Analytics ranges cannot exceed 366 days.');
    startDate = query.start;
    endDate = query.end;
    label = `${startDate} to ${endDate}`;
  }
  const endExclusiveDate = addDays(endDate, 1);
  const length = Math.round((new Date(`${endExclusiveDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000);
  const previousEndDate = addDays(startDate, -1);
  const previousStartDate = addDays(previousEndDate, -(length - 1));
  return {
    range, label, timezone: BUSINESS_TIME_ZONE,
    startDate, endDate,
    start: midnightUtc(startDate), end: midnightUtc(endExclusiveDate),
    previousStart: midnightUtc(previousStartDate), previousEnd: midnightUtc(startDate)
  };
}

const number = value => Number(value || 0);
function change(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}
function metric(value, previous) {
  const current = number(value);
  const before = number(previous);
  return { value: current, previous: before, changePercent: change(current, before) };
}
function rate(numerator, denominator) { return denominator ? Number((numerator * 100 / denominator).toFixed(2)) : 0; }

async function aggregate(start, end) {
  const [sessions, events, orders, attempts, carts] = await Promise.all([
    pool.query(`WITH scoped AS (
        SELECT * FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2
      ), visitors AS (
        SELECT visitor_id, BOOL_OR(user_id IS NOT NULL) AS logged_in FROM scoped GROUP BY visitor_id
      ) SELECT
        (SELECT COUNT(*) FROM scoped)::int AS sessions,
        COUNT(*)::int AS visitors,
        COUNT(*) FILTER (WHERE logged_in)::int AS logged_in_visitors,
        COUNT(*) FILTER (WHERE NOT logged_in)::int AS anonymous_visitors,
        COALESCE((SELECT SUM(page_views) FROM scoped),0)::int AS page_views,
        COALESCE((SELECT SUM(product_views) FROM scoped),0)::int AS product_views,
        COALESCE((SELECT AVG(LEAST(1800, GREATEST(0, EXTRACT(EPOCH FROM (last_activity_at - started_at))))) FROM scoped),0) AS average_session_seconds
      FROM visitors`, [start, end]),
    pool.query(`SELECT event_type, COUNT(*)::int AS count FROM analytics_events
      WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY event_type`, [start, end]),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE payment_status IN ('paid','refunded','partially_refunded'))::int AS successful_orders,
      COALESCE(SUM(GREATEST(total_amount - refunded_amount,0)) FILTER
        (WHERE payment_status IN ('paid','refunded','partially_refunded')),0) AS revenue,
      COUNT(*) FILTER (WHERE payment_method = 'razorpay' AND payment_status = 'pending')::int AS pending_payments,
      COUNT(*) FILTER (WHERE payment_method = 'razorpay' AND
        (payment_status = 'failed' OR (payment_status = 'pending' AND inventory_released_at IS NOT NULL)))::int AS abandoned_checkouts
      FROM orders WHERE created_at >= $1 AND created_at < $2`, [start, end]),
    pool.query(`SELECT COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM payment_attempts WHERE attempted_at >= $1 AND attempted_at < $2`, [start, end]),
    pool.query(`WITH activity AS (
      SELECT c.id, c.status, c.created_at, c.updated_at,
        GREATEST(c.created_at, COALESCE(MAX(ci.updated_at), c.created_at)) AS last_activity
      FROM carts c LEFT JOIN cart_items ci ON ci.cart_id = c.id
      GROUP BY c.id
    ) SELECT
      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS carts_used,
      COUNT(*) FILTER (WHERE status = 'active' AND last_activity + INTERVAL '24 hours' >= $1
        AND last_activity + INTERVAL '24 hours' < $2)::int AS abandoned
      FROM activity`, [start, end])
  ]);
  const s = sessions.rows[0];
  const eventCounts = Object.fromEntries(events.rows.map(row => [row.event_type, number(row.count)]));
  const o = orders.rows[0];
  const p = attempts.rows[0];
  const c = carts.rows[0];
  const visitors = number(s.visitors);
  const successfulOrders = number(o.successful_orders);
  const attemptsCount = number(p.attempts);
  const revenue = number(o.revenue);
  const abandonedCheckouts = number(o.abandoned_checkouts);
  const checkoutStarts = eventCounts.CHECKOUT_STARTED || 0;
  return {
    visitors,
    uniqueVisitors: visitors,
    loggedInVisitors: number(s.logged_in_visitors),
    anonymousVisitors: number(s.anonymous_visitors),
    sessions: number(s.sessions),
    pageViews: number(s.page_views),
    productViews: Math.max(number(s.product_views), eventCounts.PRODUCT_VIEWED || 0),
    addToCarts: eventCounts.ADD_TO_CART || 0,
    checkoutStarted: checkoutStarts,
    paymentAttempts: attemptsCount,
    successfulOrders,
    revenue,
    conversionRate: rate(successfulOrders, visitors),
    cartAbandonmentRate: rate(number(c.abandoned), number(c.carts_used)),
    checkoutAbandonmentRate: rate(abandonedCheckouts, checkoutStarts),
    paymentFailureRate: rate(number(p.failed), attemptsCount),
    averageOrderValue: successfulOrders ? Number((revenue / successfulOrders).toFixed(2)) : 0,
    averageSessionSeconds: Number(number(s.average_session_seconds).toFixed(1)),
    paymentSuccesses: number(p.successful),
    paymentFailures: number(p.failed),
    pendingPayments: number(o.pending_payments)
  };
}

async function overview(query) {
  const period = resolvePeriod(query);
  const [current, previous] = await Promise.all([
    aggregate(period.start, period.end), aggregate(period.previousStart, period.previousEnd)
  ]);
  const metrics = {};
  for (const key of Object.keys(current)) metrics[key] = metric(current[key], previous[key]);
  return { period, metrics };
}

async function revenue(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH days AS (
      SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
    ), totals AS (
      SELECT (paid_at AT TIME ZONE $3)::date AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(GREATEST(total_amount - refunded_amount,0)),0) AS revenue
      FROM orders WHERE paid_at >= $4 AND paid_at < $5
        AND payment_status IN ('paid','refunded','partially_refunded')
      GROUP BY 1
    ), traffic AS (
      SELECT (started_at AT TIME ZONE $3)::date AS day,
        COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_sessions WHERE started_at >= $4 AND started_at < $5 GROUP BY 1
    ), cart_activity AS (
      SELECT (occurred_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS add_to_carts
      FROM analytics_events WHERE occurred_at >= $4 AND occurred_at < $5
        AND event_type = 'ADD_TO_CART' GROUP BY 1
    ) SELECT days.day, COALESCE(totals.orders,0)::int AS orders,
      COALESCE(totals.revenue,0) AS revenue, COALESCE(traffic.visitors,0)::int AS visitors,
      COALESCE(cart_activity.add_to_carts,0)::int AS add_to_carts
    FROM days LEFT JOIN totals USING(day) LEFT JOIN traffic USING(day)
      LEFT JOIN cart_activity USING(day) ORDER BY days.day`,
  [period.startDate, period.endDate, BUSINESS_TIME_ZONE, period.start, period.end]);
  return { period, points: rows.map(row => ({ date: row.day, orders: number(row.orders), revenue: number(row.revenue),
    visitors: number(row.visitors), addToCarts: number(row.add_to_carts) })) };
}

async function funnel(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH session_visitors AS (
      SELECT id, visitor_id FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2
    ), event_visitors AS (
      SELECT e.event_type, COUNT(DISTINCT s.visitor_id)::int AS count
      FROM analytics_events e JOIN session_visitors s ON s.id = e.session_id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 GROUP BY e.event_type
    ) SELECT event_type, count FROM event_visitors`, [period.start, period.end]);
  const counts = Object.fromEntries(rows.map(row => [row.event_type, number(row.count)]));
  const visitors = number((await pool.query(`SELECT COUNT(DISTINCT visitor_id)::int AS count
    FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2`, [period.start, period.end])).rows[0].count);
  const stages = [
    ['Visitors', visitors], ['Product views', counts.PRODUCT_VIEWED || 0],
    ['Added to cart', counts.ADD_TO_CART || 0], ['Checkout started', counts.CHECKOUT_STARTED || 0],
    ['Payment attempted', counts.PAYMENT_STARTED || 0], ['Payment successful', counts.PAYMENT_SUCCESS || 0],
    ['Orders', counts.ORDER_CREATED || 0]
  ].map(([label, count], index, all) => ({ label, count: number(count),
    conversionFromPrevious: index ? rate(number(count), number(all[index - 1][1])) : 100,
    dropOffFromPrevious: index ? Math.max(0, Number((100 - rate(number(count), number(all[index - 1][1]))).toFixed(2))) : 0 }));
  return { period, stages };
}

async function products(query) {
  const period = resolvePeriod(query);
  const sortMap = { views: 'views', adds: 'add_to_carts', revenue: 'revenue', units: 'units_sold', conversion: 'conversion_rate' };
  const sort = sortMap[query.sort] || 'revenue';
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
  const sql = `WITH behaviour AS (
      SELECT e.product_id,
        COUNT(*) FILTER (WHERE e.event_type = 'PRODUCT_VIEWED')::int AS views,
        COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_type = 'PRODUCT_VIEWED')::int AS unique_viewers,
        COUNT(*) FILTER (WHERE e.event_type = 'ADD_TO_CART')::int AS add_to_carts
      FROM analytics_events e WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        AND e.product_id IS NOT NULL GROUP BY e.product_id
    ), sales AS (
      SELECT oi.product_id, COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity),0)::int AS units_sold,
        COALESCE(SUM(oi.total_price - (oi.total_price / NULLIF(o.total_amount,0) * o.refunded_amount)),0) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.paid_at >= $1 AND o.paid_at < $2
        AND o.payment_status IN ('paid','refunded','partially_refunded')
      GROUP BY oi.product_id
    ), checkouts AS (
      SELECT oi.product_id, COUNT(DISTINCT o.id)::int AS checkouts
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2 GROUP BY oi.product_id
    ) SELECT p.id, p.name,
      COALESCE(b.views,0)::int AS views, COALESCE(b.unique_viewers,0)::int AS unique_viewers,
      COALESCE(b.add_to_carts,0)::int AS add_to_carts, COALESCE(c.checkouts,0)::int AS checkouts,
      COALESCE(s.units_sold,0)::int AS units_sold, COALESCE(s.orders,0)::int AS orders,
      COALESCE(s.revenue,0) AS revenue,
      CASE WHEN COALESCE(b.views,0) = 0 THEN 0 ELSE ROUND(b.add_to_carts * 100.0 / b.views,2) END AS add_to_cart_rate,
      CASE WHEN COALESCE(b.unique_viewers,0) = 0 THEN 0 ELSE ROUND(COALESCE(s.orders,0) * 100.0 / b.unique_viewers,2) END AS conversion_rate
    FROM products p LEFT JOIN behaviour b ON b.product_id = p.id
      LEFT JOIN sales s ON s.product_id = p.id LEFT JOIN checkouts c ON c.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY ${sort} ${direction}, p.name ASC LIMIT $3`;
  const { rows } = await pool.query(sql, [period.start, period.end, limit]);
  return { period, products: rows.map(row => ({ id: row.id, name: row.name, views: number(row.views),
    uniqueViewers: number(row.unique_viewers), addToCarts: number(row.add_to_carts),
    addToCartRate: number(row.add_to_cart_rate), checkouts: number(row.checkouts), unitsSold: number(row.units_sold),
    orders: number(row.orders), revenue: number(row.revenue), conversionRate: number(row.conversion_rate) })) };
}

async function carts(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH cart_activity AS (
      SELECT c.id, c.user_id, c.status, c.created_at, c.updated_at,
        GREATEST(c.created_at, COALESCE(MAX(ci.updated_at), c.created_at)) AS last_activity,
        COALESCE(SUM(ci.quantity * COALESCE(pv.price,p.base_price)),0) AS value,
        COALESCE(SUM(ci.quantity),0)::int AS quantity,
        STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS products
      FROM carts c LEFT JOIN cart_items ci ON ci.cart_id = c.id
      LEFT JOIN products p ON p.id = ci.product_id LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      GROUP BY c.id
    ), scoped AS (
      SELECT *, status = 'active' AND quantity > 0 AND last_activity < NOW() - INTERVAL '24 hours' AS abandoned,
        status = 'converted' AND updated_at - last_activity >= INTERVAL '24 hours' AS recovered
      FROM cart_activity WHERE created_at < $2 AND last_activity >= $1
    ) SELECT *,
      EXISTS(SELECT 1 FROM orders o WHERE o.cart_id = scoped.id) AS checkout_started,
      EXISTS(SELECT 1 FROM orders o WHERE o.cart_id = scoped.id AND o.payment_status IN ('paid','refunded','partially_refunded')) AS purchased,
      SUBSTRING(MD5(user_id::text),1,10) AS customer_reference
    FROM scoped ORDER BY abandoned DESC, last_activity DESC LIMIT 100`, [period.start, period.end]);
  const summary = rows.reduce((value, row) => {
    value.total += 1;
    if (row.status === 'active') value.active += 1;
    if (row.abandoned) { value.abandoned += 1; value.estimatedAbandonedValue += number(row.value); }
    if (row.recovered) value.recovered += 1;
    return value;
  }, { total: 0, active: 0, abandoned: 0, recovered: 0, estimatedAbandonedValue: 0 });
  return { period, summary, carts: rows.map(row => ({ id: row.id, customerReference: row.customer_reference,
    products: row.products || '', quantity: number(row.quantity), value: number(row.value), status: row.status,
    lastActivity: row.last_activity, ageHours: Math.max(0, Number(((Date.now() - new Date(row.last_activity)) / 3600000).toFixed(1))),
    checkoutStarted: row.checkout_started, purchased: row.purchased, abandoned: row.abandoned })) };
}

async function payments(query) {
  const period = resolvePeriod(query);
  const [summaryResult, issueResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status='successful')::int AS successful,
      COUNT(*) FILTER (WHERE status='failed')::int AS failed
      FROM payment_attempts WHERE attempted_at >= $1 AND attempted_at < $2`, [period.start, period.end]),
    pool.query(`SELECT o.order_number, o.total_amount, pa.status, pa.failure_category, pa.attempted_at,
      SUBSTRING(MD5(o.user_id::text),1,10) AS customer_reference
      FROM payment_attempts pa JOIN orders o ON o.id = pa.order_id
      WHERE pa.attempted_at >= $1 AND pa.attempted_at < $2 AND pa.status = 'failed'
      ORDER BY pa.attempted_at DESC LIMIT 50`, [period.start, period.end])
  ]);
  const row = summaryResult.rows[0];
  const pending = number((await pool.query(`SELECT COUNT(*)::int AS count FROM orders
    WHERE payment_method='razorpay' AND payment_status='pending' AND created_at >= $1 AND created_at < $2`,
  [period.start, period.end])).rows[0].count);
  const attempts = number(row.attempts);
  return { period, summary: { attempts, successful: number(row.successful), failed: number(row.failed), pending,
    successRate: rate(number(row.successful), attempts), failureRate: rate(number(row.failed), attempts) },
  issues: issueResult.rows.map(issue => ({ orderReference: issue.order_number, customerReference: issue.customer_reference,
    amount: number(issue.total_amount), status: issue.status, failureCategory: issue.failure_category || 'unspecified',
    attemptedAt: issue.attempted_at })) };
}

async function visitors(query) {
  const period = resolvePeriod(query);
  const [segments, hourly, users] = await Promise.all([
    pool.query(`WITH scoped AS (
      SELECT visitor_id, MIN(started_at) AS first_in_period FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2 GROUP BY visitor_id
    ) SELECT COUNT(*)::int AS visitors,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_sessions previous
        WHERE previous.visitor_id=scoped.visitor_id AND previous.started_at < $1))::int AS returning
      FROM scoped`, [period.start, period.end]),
    pool.query(`SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE $3)::int AS hour,
      COUNT(*)::int AS sessions, COUNT(DISTINCT visitor_id)::int AS visitors
      FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 GROUP BY 1 ORDER BY 1`,
    [period.start, period.end, BUSINESS_TIME_ZONE]),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE u.created_at >= $1 AND u.created_at < $2)::int AS new_users,
      COUNT(*) FILTER (WHERE purchases.orders > 0)::int AS customers_purchased,
      COUNT(*) FILTER (WHERE purchases.orders = 0)::int AS customers_never_purchased,
      COUNT(*) FILTER (WHERE purchases.orders > 1)::int AS repeat_customers
      FROM users u JOIN roles r ON r.id=u.role_id AND r.name='customer'
      CROSS JOIN LATERAL (SELECT COUNT(*)::int AS orders FROM orders o
        WHERE o.user_id=u.id AND o.payment_status IN ('paid','refunded','partially_refunded')) purchases`,
    [period.start, period.end])
  ]);
  const segment = segments.rows[0];
  const total = number(segment.visitors);
  const returning = number(segment.returning);
  return { period, summary: { visitors: total, newVisitors: total - returning, returningVisitors: returning,
    newUsers: number(users.rows[0].new_users), customersPurchased: number(users.rows[0].customers_purchased),
    customersNeverPurchased: number(users.rows[0].customers_never_purchased), repeatCustomers: number(users.rows[0].repeat_customers) },
  hourly: Array.from({ length: 24 }, (_, hour) => {
    const value = hourly.rows.find(row => number(row.hour) === hour);
    return { hour, sessions: number(value?.sessions), visitors: number(value?.visitors) };
  }) };
}

module.exports = { BUSINESS_TIME_ZONE, resolvePeriod, overview, revenue, funnel, products, carts, payments, visitors };
