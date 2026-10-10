const { pool } = require('../config/db');

const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const INDIA_OFFSET = '+05:30';
const RANGE_VALUES = new Set(['today', 'yesterday', '7d', '30d', 'this_month', 'custom']);
const KPI_DEFINITIONS = {
  visitors: 'Distinct customer accounts when signed in, otherwise distinct anonymous browser identifiers; admin traffic is excluded.',
  newVisitors: 'Customer accounts or anonymous browsers whose first recorded session occurred during the selected period.',
  returningVisitors: 'Customer accounts or anonymous browsers with a recorded session before the selected period who returned during it.',
  loggedInVisitors: 'Distinct customer accounts seen during the period, regardless of browser or device.',
  anonymousVisitors: 'Distinct anonymous browser identifiers seen during the period.',
  loginEvents: 'Successful customer login events recorded during the period.',
  signups: 'New customer account creation events recorded during the period.',
  uniqueUsersLoggedIn: 'Distinct customer account IDs with a successful login event in the period.',
  repeatLoginUsers: 'Distinct customer accounts with more than one successful login in the period.',
  sessions: 'Customer sessions started in the period. A session expires after 30 minutes of inactivity.',
  pageViews: 'Customer page-view events recorded in the period.',
  totalActiveSeconds: 'Total active foreground seconds reported by customer sessions.',
  productViews: 'Product detail view events recorded in the period.',
  uniqueProductViewers: 'Distinct customer accounts or anonymous browsers that viewed at least one product in the period.',
  productsViewed: 'Distinct products viewed in the period.',
  addToCartVisitors: 'Distinct customer accounts or anonymous browsers that added at least one product to cart in the period.',
  addToCarts: 'Server-authoritative signed-in cart additions plus browser-tracked guest cart additions.',
  removeFromCarts: 'Server-authoritative signed-in removals plus browser-tracked guest removals.',
  checkoutStarted: 'Distinct customer accounts or anonymous browsers that started checkout during the period.',
  paymentAttempts: 'Gateway payment attempts recorded during the period.',
  paymentSuccesses: 'Gateway payment attempts confirmed successful during the period.',
  paymentFailures: 'Gateway payment attempts recorded as failed during the period.',
  successfulOrders: 'Orders with a successful payment state created during the period.',
  ordersPlaced: 'Confirmed COD orders plus orders with successful online payment, excluding cancelled orders.',
  uniquePurchasers: 'Distinct customer account IDs with a successful order in the period.',
  grossOrderValue: 'Total value of qualifying successful orders created in the period, before refunds.',
  grossRevenue: 'Successful incoming order credits recorded in the financial ledger.',
  refunds: 'Completed outgoing refunds recorded in the financial ledger.',
  pendingRefunds: 'Refund debits in the financial ledger that have not completed.',
  revenue: 'Net realized revenue: successful ledger credits minus completed ledger refunds.',
  averageOrderValue: 'Net realized revenue divided by successful orders.',
  conversionRate: 'Successful orders divided by distinct visitors.',
  cartAbandonmentRate: 'Carts with items inactive for at least 24 hours divided by carts used.',
  checkoutAbandonmentRate: 'Checkout starters without a successful order divided by checkout starters.',
  paymentFailureRate: 'Failed payment attempts divided by all payment attempts.',
  averageSessionSeconds: 'Average active foreground time reported by customer sessions, excluding idle time.',
  averagePageViewsPerSession: 'Customer page views divided by customer sessions.',
  returnRequests: 'Customer return requests created during the period.',
  completedReturns: 'Returns completed during the period.',
  returnRate: 'Return requests divided by successful orders in the selected period.',
  refundsInitiated: 'Returns whose refund workflow reached processing or refunded state.',
  refundsCompleted: 'Returns whose refund status is refunded.',
  frontendErrors: 'Sanitized browser error events recorded during the period.',
  affectedErrorSessions: 'Distinct customer sessions with at least one sanitized frontend error.',
  errorRate: 'Affected error sessions divided by all customer sessions.'
};

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
    previousStart: midnightUtc(previousStartDate), previousEnd: midnightUtc(startDate), lengthDays: length
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

async function aggregate(start, end, database = pool) {
  const [sessions, events, orders, attempts, carts, ledger, returns, cohorts] = await Promise.all([
    database.query(`WITH scoped AS (
        SELECT *,CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END AS identity
        FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal
      ), visitors AS (
        SELECT identity,MAX(user_id) AS user_id, BOOL_OR(user_id IS NOT NULL) AS logged_in FROM scoped GROUP BY identity
      ) SELECT
        (SELECT COUNT(*) FROM scoped)::int AS sessions,
        COUNT(*)::int AS visitors,
        COUNT(*) FILTER (WHERE logged_in)::int AS logged_in_visitors,
        COUNT(*) FILTER (WHERE NOT logged_in)::int AS anonymous_visitors,
        COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_sessions old
          WHERE (CASE WHEN old.user_id IS NULL THEN 'visitor:'||old.visitor_id::text ELSE 'user:'||old.user_id::text END)=visitors.identity
          AND old.started_at < $1 AND NOT old.is_internal))::int AS returning_visitors,
        COALESCE((SELECT SUM(page_views) FROM scoped),0)::int AS page_views,
        COALESCE((SELECT SUM(product_views) FROM scoped),0)::int AS product_views,
        COALESCE((SELECT SUM(active_seconds) FROM scoped),0)::int AS total_active_seconds,
        COALESCE((SELECT AVG(active_seconds) FROM scoped),0) AS average_session_seconds
      FROM visitors`, [start, end]),
    database.query(`SELECT e.event_type, COUNT(*)::int AS count FROM analytics_events e
      JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 GROUP BY e.event_type`, [start, end]),
    database.query(`SELECT
      COUNT(*) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
        OR (payment_method='cod' AND payment_status='pending')))::int AS orders_placed,
      COUNT(*) FILTER (WHERE payment_status IN ('paid','refunded','partially_refunded'))::int AS successful_orders,
      COUNT(DISTINCT user_id) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
        OR (payment_method='cod' AND payment_status='pending')))::int AS unique_purchasers,
      COALESCE(SUM(total_amount) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
        OR (payment_method='cod' AND payment_status='pending'))),0) AS gross_order_value,
      COALESCE(SUM(GREATEST(total_amount - refunded_amount,0)) FILTER
        (WHERE payment_status IN ('paid','refunded','partially_refunded')),0) AS revenue,
      COUNT(*) FILTER (WHERE payment_method = 'razorpay' AND payment_status = 'pending')::int AS pending_payments,
      COUNT(*) FILTER (WHERE payment_method = 'razorpay' AND
        (payment_status = 'failed' OR (payment_status = 'pending' AND inventory_released_at IS NOT NULL)))::int AS abandoned_checkouts
      FROM orders WHERE order_type = 'normal' AND created_at >= $1 AND created_at < $2`, [start, end]),
    database.query(`SELECT COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM payment_attempts WHERE attempted_at >= $1 AND attempted_at < $2`, [start, end]),
    database.query(`WITH activity AS (
      SELECT c.id, c.status, c.created_at, c.updated_at,
        GREATEST(c.created_at, COALESCE(MAX(ci.updated_at), c.created_at)) AS last_activity
      FROM carts c LEFT JOIN cart_items ci ON ci.cart_id = c.id
      GROUP BY c.id
    ) SELECT
      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS carts_used,
      COUNT(*) FILTER (WHERE status = 'active' AND last_activity + INTERVAL '24 hours' >= $1
        AND last_activity + INTERVAL '24 hours' < $2)::int AS abandoned
      FROM activity`, [start, end]),
    database.query(`SELECT
      COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT' AND status='SUCCESS'),0) AS gross_revenue,
      COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT' AND status='SUCCESS'),0) AS refunds,
      COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT' AND status='PENDING'),0) AS pending_refunds
      FROM financial_transactions WHERE occurred_at >= $1 AND occurred_at < $2`, [start, end]),
    database.query(`SELECT COUNT(*)::int AS requested,
      COUNT(*) FILTER (WHERE status='refunded')::int AS completed,
      COUNT(*) FILTER (WHERE refund_status IN ('processing','refunded'))::int AS refunds_initiated,
      COUNT(*) FILTER (WHERE refund_status='refunded')::int AS refunds_completed
      FROM return_requests WHERE requested_at >= $1 AND requested_at < $2`, [start, end]),
    database.query(`WITH login_users AS (
      SELECT user_id,COUNT(*) AS login_count FROM analytics_events
      WHERE event_type='LOGIN' AND occurred_at >= $1 AND occurred_at < $2 GROUP BY user_id
    ) SELECT
      COUNT(DISTINCT e.user_id) FILTER (WHERE e.event_type='LOGIN')::int AS unique_users_logged_in,
      (SELECT COUNT(*)::int FROM login_users WHERE login_count>1) AS repeat_login_users,
      COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE e.event_type='PRODUCT_VIEWED')::int AS unique_product_viewers,
      COUNT(DISTINCT e.product_id) FILTER (WHERE e.event_type='PRODUCT_VIEWED')::int AS products_viewed,
      COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE e.event_type='ADD_TO_CART')::int AS add_to_cart_visitors,
      COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_type='FRONTEND_ERROR')::int AS affected_error_sessions
    FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
    WHERE e.occurred_at >= $1 AND e.occurred_at < $2`, [start, end])
  ]);
  const s = sessions.rows[0];
  const eventCounts = Object.fromEntries(events.rows.map(row => [row.event_type, number(row.count)]));
  const o = orders.rows[0];
  const p = attempts.rows[0];
  const c = carts.rows[0];
  const visitors = number(s.visitors);
  const successfulOrders = number(o.successful_orders);
  const attemptsCount = number(p.attempts);
  const l = ledger.rows[0];
  const r = returns.rows[0];
  const h = cohorts.rows[0];
  const grossRevenue = number(l.gross_revenue);
  const refunds = number(l.refunds);
  const revenue = grossRevenue - refunds;
  const abandonedCheckouts = number(o.abandoned_checkouts);
  const checkoutStarts = eventCounts.CHECKOUT_STARTED || 0;
  return {
    visitors,
    loggedInVisitors: number(s.logged_in_visitors),
    anonymousVisitors: number(s.anonymous_visitors),
    returningVisitors: number(s.returning_visitors),
    newVisitors: Math.max(0, visitors - number(s.returning_visitors)),
    loginEvents: eventCounts.LOGIN || 0,
    signups: eventCounts.SIGNUP || 0,
    uniqueUsersLoggedIn: number(h.unique_users_logged_in),
    repeatLoginUsers: number(h.repeat_login_users),
    sessions: number(s.sessions),
    pageViews: number(s.page_views),
    totalActiveSeconds: number(s.total_active_seconds),
    productViews: Math.max(number(s.product_views), eventCounts.PRODUCT_VIEWED || 0),
    uniqueProductViewers: number(h.unique_product_viewers),
    productsViewed: number(h.products_viewed),
    addToCarts: eventCounts.ADD_TO_CART || 0,
    addToCartVisitors: number(h.add_to_cart_visitors),
    removeFromCarts: eventCounts.REMOVE_FROM_CART || 0,
    checkoutStarted: checkoutStarts,
    paymentAttempts: attemptsCount,
    ordersPlaced: number(o.orders_placed),
    successfulOrders,
    uniquePurchasers: number(o.unique_purchasers),
    grossOrderValue: number(o.gross_order_value),
    grossRevenue,
    refunds,
    pendingRefunds: number(l.pending_refunds),
    revenue,
    conversionRate: rate(number(o.unique_purchasers), visitors),
    cartAbandonmentRate: rate(number(c.abandoned), number(c.carts_used)),
    checkoutAbandonmentRate: rate(abandonedCheckouts, checkoutStarts),
    paymentFailureRate: rate(number(p.failed), attemptsCount),
    paymentSuccessRate: rate(number(p.successful), attemptsCount),
    averageOrderValue: successfulOrders ? Number((revenue / successfulOrders).toFixed(2)) : 0,
    averageSessionSeconds: Number(number(s.average_session_seconds).toFixed(1)),
    averagePageViewsPerSession: number(s.sessions) ? Number((number(s.page_views) / number(s.sessions)).toFixed(2)) : 0,
    paymentSuccesses: number(p.successful),
    paymentFailures: number(p.failed),
    pendingPayments: number(o.pending_payments),
    returnRequests: number(r.requested),
    completedReturns: number(r.completed),
    returnRate: rate(number(r.requested), successfulOrders),
    refundsInitiated: number(r.refunds_initiated),
    refundsCompleted: number(r.refunds_completed),
    frontendErrors: eventCounts.FRONTEND_ERROR || 0,
    affectedErrorSessions: number(h.affected_error_sessions),
    errorRate: rate(number(h.affected_error_sessions), number(s.sessions))
  };
}

async function overview(query) {
  const period = resolvePeriod(query);
  const [current, previous] = await Promise.all([
    aggregate(period.start, period.end), aggregate(period.previousStart, period.previousEnd)
  ]);
  const metrics = {};
  for (const key of Object.keys(current)) metrics[key] = metric(current[key], previous[key]);
  const tracking = await pool.query(`SELECT MIN(started_at) AS started_at FROM analytics_sessions WHERE NOT is_internal`);
  return { period, metrics, definitions: KPI_DEFINITIONS, trackingStartedAt: tracking.rows[0]?.started_at || null };
}

async function revenue(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH days AS (
      SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
    ), totals AS (
      SELECT (ft.occurred_at AT TIME ZONE $3)::date AS day,
        COALESCE(SUM(ft.amount) FILTER (WHERE ft.direction='CREDIT' AND ft.status='SUCCESS'),0)
          - COALESCE(SUM(ft.amount) FILTER (WHERE ft.direction='DEBIT' AND ft.status='SUCCESS'),0) AS revenue
      FROM financial_transactions ft WHERE ft.occurred_at >= $4 AND ft.occurred_at < $5
      GROUP BY 1
    ), orders_by_day AS (
      SELECT (created_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS orders
      FROM orders WHERE order_type = 'normal' AND created_at >= $4 AND created_at < $5
        AND payment_status IN ('paid','refunded','partially_refunded') GROUP BY 1
    ), traffic AS (
      SELECT (started_at AT TIME ZONE $3)::date AS day,
        COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END)::int AS visitors
      FROM analytics_sessions WHERE started_at >= $4 AND started_at < $5 AND NOT is_internal GROUP BY 1
    ), cart_activity AS (
      SELECT (occurred_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS add_to_carts
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $4 AND e.occurred_at < $5
        AND e.event_type = 'ADD_TO_CART' GROUP BY 1
    ) SELECT days.day, COALESCE(orders_by_day.orders,0)::int AS orders,
      COALESCE(totals.revenue,0) AS revenue, COALESCE(traffic.visitors,0)::int AS visitors,
      COALESCE(cart_activity.add_to_carts,0)::int AS add_to_carts
    FROM days LEFT JOIN totals USING(day) LEFT JOIN orders_by_day USING(day) LEFT JOIN traffic USING(day)
      LEFT JOIN cart_activity USING(day) ORDER BY days.day`,
  [period.startDate, period.endDate, BUSINESS_TIME_ZONE, period.start, period.end]);
  return { period, points: rows.map(row => ({ date: row.day, orders: number(row.orders), revenue: number(row.revenue),
    visitors: number(row.visitors), addToCarts: number(row.add_to_carts) })) };
}

async function funnel(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH session_visitors AS (
      SELECT id, visitor_id, user_id FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal
    ), event_visitors AS (
      SELECT e.event_type, COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END)::int AS count
      FROM analytics_events e JOIN session_visitors s ON s.id = e.session_id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 GROUP BY e.event_type
    ) SELECT event_type, count FROM event_visitors`, [period.start, period.end]);
  const counts = Object.fromEntries(rows.map(row => [row.event_type, number(row.count)]));
  const visitors = number((await pool.query(`SELECT COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END)::int AS count
    FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal`, [period.start, period.end])).rows[0].count);
  const stages = [
    ['Visitors', visitors], ['Product views', counts.PRODUCT_VIEWED || 0],
    ['Added to cart', counts.ADD_TO_CART || 0], ['Checkout started', counts.CHECKOUT_STARTED || 0],
    ['Payment attempted', counts.PAYMENT_STARTED || 0], ['Payment successful', counts.PAYMENT_SUCCESS || 0],
    ['Orders', counts.ORDER_CREATED || 0]
  ].map(([label, count], index, all) => ({ label, count: number(count),
    conversionFromPrevious: index ? rate(number(count), number(all[index - 1][1])) : 100,
    dropOffFromPrevious: index ? Math.max(0, Number((100 - rate(number(count), number(all[index - 1][1]))).toFixed(2))) : 0 }));
  const guestResult = await pool.query(`WITH scoped_sessions AS (
      SELECT id,visitor_id FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal
    ), guest_visitors AS (
      SELECT DISTINCT s.visitor_id FROM scoped_sessions s JOIN analytics_events e ON e.session_id=s.id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.user_id IS NULL
    ) SELECT
      COUNT(*)::int AS guest_visitors,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_events e JOIN scoped_sessions s ON s.id=e.session_id
        WHERE s.visitor_id=g.visitor_id AND e.event_type='PRODUCT_VIEWED' AND e.user_id IS NULL))::int AS product_viewers,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_events e JOIN scoped_sessions s ON s.id=e.session_id
        WHERE s.visitor_id=g.visitor_id AND e.event_type='ADD_TO_CART' AND e.user_id IS NULL))::int AS cart_visitors,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_events e JOIN scoped_sessions s ON s.id=e.session_id
        WHERE s.visitor_id=g.visitor_id AND e.event_type='CHECKOUT_STARTED'))::int AS checkout_visitors,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_events e JOIN scoped_sessions s ON s.id=e.session_id
        WHERE s.visitor_id=g.visitor_id AND e.event_type IN ('LOGIN','SIGNUP')))::int AS later_logged_in,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM orders o JOIN scoped_sessions s ON s.id=o.analytics_session_id
        WHERE s.visitor_id=g.visitor_id AND o.payment_status IN ('paid','refunded','partially_refunded')))::int AS purchased
    FROM guest_visitors g`, [period.start, period.end]);
  const guest = guestResult.rows[0];
  return { period, stages, guest: { visitors: number(guest.guest_visitors), productViewers: number(guest.product_viewers),
    addToCartVisitors: number(guest.cart_visitors), checkoutVisitors: number(guest.checkout_visitors),
    laterLoggedIn: number(guest.later_logged_in), purchased: number(guest.purchased) } };
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
        COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE e.event_type = 'PRODUCT_VIEWED')::int AS unique_viewers,
        COUNT(DISTINCT s.user_id) FILTER (WHERE e.event_type = 'PRODUCT_VIEWED' AND s.user_id IS NOT NULL)::int AS logged_in_viewers,
        COUNT(DISTINCT s.visitor_id) FILTER (WHERE e.event_type = 'PRODUCT_VIEWED' AND s.user_id IS NULL)::int AS guest_viewers,
        COUNT(*) FILTER (WHERE e.event_type = 'ADD_TO_CART')::int AS add_to_carts,
        COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE e.event_type = 'ADD_TO_CART')::int AS unique_cart_visitors
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        AND e.product_id IS NOT NULL GROUP BY e.product_id
    ), sales AS (
      SELECT oi.product_id, COUNT(DISTINCT o.id)::int AS orders,
        COALESCE(SUM(oi.quantity),0)::int AS units_sold,
        COALESCE(SUM(oi.total_price - (oi.total_price / NULLIF(o.total_amount,0) * o.refunded_amount)),0) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.order_type = 'normal'
      WHERE o.paid_at >= $1 AND o.paid_at < $2
        AND o.payment_status IN ('paid','refunded','partially_refunded')
      GROUP BY oi.product_id
    ), checkouts AS (
      SELECT oi.product_id, COUNT(DISTINCT o.id)::int AS checkouts
      FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.order_type = 'normal'
      WHERE o.created_at >= $1 AND o.created_at < $2 GROUP BY oi.product_id
    ) SELECT p.id, p.name,
      COALESCE(b.views,0)::int AS views, COALESCE(b.unique_viewers,0)::int AS unique_viewers,
      COALESCE(b.logged_in_viewers,0)::int AS logged_in_viewers, COALESCE(b.guest_viewers,0)::int AS guest_viewers,
      COALESCE(b.add_to_carts,0)::int AS add_to_carts, COALESCE(c.checkouts,0)::int AS checkouts,
      COALESCE(b.unique_cart_visitors,0)::int AS unique_cart_visitors,
      COALESCE(s.units_sold,0)::int AS units_sold, COALESCE(s.orders,0)::int AS orders,
      COALESCE(s.revenue,0) AS revenue,
      CASE WHEN COALESCE(b.unique_viewers,0) = 0 THEN 0 ELSE ROUND(b.unique_cart_visitors * 100.0 / b.unique_viewers,2) END AS add_to_cart_rate,
      CASE WHEN COALESCE(b.unique_cart_visitors,0) = 0 THEN 0 ELSE ROUND(COALESCE(s.orders,0) * 100.0 / b.unique_cart_visitors,2) END AS cart_purchase_rate,
      CASE WHEN COALESCE(b.unique_viewers,0) = 0 THEN 0 ELSE ROUND(COALESCE(s.orders,0) * 100.0 / b.unique_viewers,2) END AS conversion_rate
    FROM products p LEFT JOIN behaviour b ON b.product_id = p.id
      LEFT JOIN sales s ON s.product_id = p.id LEFT JOIN checkouts c ON c.product_id = p.id
    WHERE p.is_active = TRUE
    ORDER BY ${sort} ${direction}, p.name ASC LIMIT $3`;
  const { rows } = await pool.query(sql, [period.start, period.end, limit]);
  return { period, products: rows.map(row => ({ id: row.id, name: row.name, views: number(row.views),
    uniqueViewers: number(row.unique_viewers), loggedInViewers: number(row.logged_in_viewers), guestViewers: number(row.guest_viewers), addToCarts: number(row.add_to_carts),
    uniqueCartVisitors: number(row.unique_cart_visitors), cartPurchaseRate: number(row.cart_purchase_rate),
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
      EXISTS(SELECT 1 FROM orders o WHERE o.order_type = 'normal' AND o.cart_id = scoped.id) AS checkout_started,
      EXISTS(SELECT 1 FROM orders o WHERE o.order_type = 'normal' AND o.cart_id = scoped.id AND o.payment_status IN ('paid','refunded','partially_refunded')) AS purchased,
      EXISTS(SELECT 1 FROM orders o JOIN payment_attempts pa ON pa.order_id=o.id WHERE o.cart_id=scoped.id) AS payment_attempted,
      (SELECT pa.status FROM orders o JOIN payment_attempts pa ON pa.order_id=o.id
        WHERE o.cart_id=scoped.id ORDER BY pa.attempted_at DESC LIMIT 1) AS last_payment_status,
      SUBSTRING(MD5(user_id::text),1,10) AS customer_reference
    FROM scoped ORDER BY abandoned DESC, last_activity DESC LIMIT 100`, [period.start, period.end]);
  const guestResult = await pool.query(`WITH guest_events AS (
      SELECT e.session_id, s.visitor_id, e.occurred_at, e.event_type, e.product_id,
        GREATEST(COALESCE((e.metadata->>'quantity')::int,1),1) AS quantity,
        COALESCE((e.metadata->>'estimatedValue')::numeric,0) AS estimated_value
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.user_id IS NULL
        AND e.event_type IN ('ADD_TO_CART','REMOVE_FROM_CART')
    ), journeys AS (
      SELECT ge.session_id, ge.visitor_id, MAX(ge.occurred_at) AS last_activity,
        GREATEST(SUM(CASE WHEN ge.event_type='ADD_TO_CART' THEN ge.quantity ELSE -ge.quantity END),0)::int AS quantity,
        GREATEST(SUM(CASE WHEN ge.event_type='ADD_TO_CART' THEN ge.estimated_value ELSE -ge.estimated_value END),0) AS value,
        STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS products
      FROM guest_events ge LEFT JOIN products p ON p.id=ge.product_id GROUP BY ge.session_id,ge.visitor_id
    ) SELECT session_id AS id, SUBSTRING(MD5(visitor_id::text),1,10) AS customer_reference,
      products, quantity, value, 'guest' AS status, last_activity,
      quantity > 0 AND last_activity < NOW()-INTERVAL '24 hours' AS abandoned,
      EXISTS(SELECT 1 FROM analytics_events e WHERE e.session_id=journeys.session_id AND e.event_type='CHECKOUT_STARTED') AS checkout_started,
      EXISTS(SELECT 1 FROM analytics_events e WHERE e.session_id=journeys.session_id AND e.event_type='PAYMENT_STARTED') AS payment_attempted,
      (SELECT CASE WHEN e.event_type='PAYMENT_SUCCESS' THEN 'successful' WHEN e.event_type='PAYMENT_FAILED' THEN 'failed' ELSE 'started' END
        FROM analytics_events e WHERE e.session_id=journeys.session_id AND e.event_type IN ('PAYMENT_STARTED','PAYMENT_SUCCESS','PAYMENT_FAILED')
        ORDER BY e.occurred_at DESC LIMIT 1) AS last_payment_status,
      EXISTS(SELECT 1 FROM orders o WHERE o.order_type = 'normal' AND o.analytics_session_id=journeys.session_id
        AND o.payment_status IN ('paid','refunded','partially_refunded')) AS purchased
    FROM journeys WHERE quantity > 0 ORDER BY abandoned DESC,last_activity DESC LIMIT 100`, [period.start, period.end]);
  const allRows = [...rows, ...guestResult.rows];
  const summary = allRows.reduce((value, row) => {
    value.total += 1;
    if (row.status === 'active') value.active += 1;
    if (row.abandoned) { value.abandoned += 1; value.estimatedAbandonedValue += number(row.value); }
    if (row.recovered) value.recovered += 1;
    return value;
  }, { total: 0, active: 0, abandoned: 0, recovered: 0, estimatedAbandonedValue: 0 });
  return { period, summary, carts: allRows.map(row => ({ id: row.id, customerReference: row.customer_reference,
    products: row.products || '', quantity: number(row.quantity), value: number(row.value), status: row.status,
    lastActivity: row.last_activity, ageHours: Math.max(0, Number(((Date.now() - new Date(row.last_activity)) / 3600000).toFixed(1))),
    checkoutStarted: row.checkout_started, paymentAttempted: row.payment_attempted,
    lastPaymentStatus: row.last_payment_status || 'none', purchased: row.purchased, abandoned: row.abandoned })) };
}

async function payments(query) {
  const period = resolvePeriod(query);
  const [summaryResult, issueResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status='successful')::int AS successful,
      COUNT(*) FILTER (WHERE status='failed')::int AS failed
      FROM payment_attempts WHERE attempted_at >= $1 AND attempted_at < $2`, [period.start, period.end]),
    pool.query(`SELECT o.order_number, o.total_amount, o.payment_method, pa.status, pa.failure_category, pa.attempted_at,
      SUBSTRING(MD5(pa.gateway_payment_id),1,12) AS provider_reference,
      (SELECT COUNT(*) FROM payment_attempts retry WHERE retry.order_id=pa.order_id)>1 AS retried,
      o.payment_status IN ('paid','refunded','partially_refunded') AS eventually_purchased,
      SUBSTRING(MD5(o.user_id::text),1,10) AS customer_reference
      FROM payment_attempts pa JOIN orders o ON o.id = pa.order_id
      WHERE pa.attempted_at >= $1 AND pa.attempted_at < $2
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
    amount: number(issue.total_amount), paymentMethod: issue.payment_method, status: issue.status,
    providerReference: issue.provider_reference, retried: issue.retried, eventuallyPurchased: issue.eventually_purchased,
    failureCategory: issue.failure_category || (issue.status === 'successful' ? 'none' : 'unspecified'),
    attemptedAt: issue.attempted_at })) };
}

async function visitors(query) {
  const period = resolvePeriod(query);
  const [segments, hourly, users] = await Promise.all([
    pool.query(`WITH scoped AS (
      SELECT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END AS identity,
        MIN(started_at) AS first_in_period FROM analytics_sessions
      WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal GROUP BY 1
    ) SELECT COUNT(*)::int AS visitors,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM analytics_sessions previous
        WHERE (CASE WHEN previous.user_id IS NULL THEN 'visitor:'||previous.visitor_id::text ELSE 'user:'||previous.user_id::text END)=scoped.identity
          AND previous.started_at < $1 AND NOT previous.is_internal))::int AS returning
      FROM scoped`, [period.start, period.end]),
    pool.query(`SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE $3)::int AS hour,
      COUNT(*)::int AS sessions,
      COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END)::int AS visitors
      FROM analytics_sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_internal GROUP BY 1 ORDER BY 1`,
    [period.start, period.end, BUSINESS_TIME_ZONE]),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE u.created_at >= $1 AND u.created_at < $2)::int AS new_users,
      COUNT(*) FILTER (WHERE purchases.orders > 0)::int AS customers_purchased,
      COUNT(*) FILTER (WHERE purchases.orders = 0)::int AS customers_never_purchased,
      COUNT(*) FILTER (WHERE purchases.orders > 1)::int AS repeat_customers
      FROM users u JOIN roles r ON r.id=u.role_id AND r.name='customer'
      CROSS JOIN LATERAL (SELECT COUNT(*)::int AS orders FROM orders o
        WHERE o.user_id=u.id AND o.order_type = 'normal' AND o.payment_status IN ('paid','refunded','partially_refunded')) purchases`,
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

async function logins(query) {
  const period = resolvePeriod(query);
  const [{ rows }, userResult] = await Promise.all([pool.query(`SELECT e.occurred_at, e.event_type,
      SUBSTRING(MD5(e.user_id::text),1,10) AS customer_reference,
      SUBSTRING(MD5(s.visitor_id::text),1,10) AS visitor_reference,
      s.entry_path, s.exit_path
    FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
    WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.event_type IN ('LOGIN','SIGNUP')
    ORDER BY e.occurred_at DESC LIMIT 100`, [period.start, period.end]),
  pool.query(`SELECT SUBSTRING(MD5(e.user_id::text),1,10) AS customer_reference,COUNT(*)::int AS login_count,
      MIN(e.occurred_at) AS first_login,MAX(e.occurred_at) AS last_login
    FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
    WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.event_type='LOGIN'
    GROUP BY e.user_id ORDER BY login_count DESC,last_login DESC LIMIT 100`, [period.start, period.end])]);
  return { period, events: rows.map(row => ({ occurredAt: row.occurred_at, type: row.event_type,
    customerReference: row.customer_reference, visitorReference: row.visitor_reference,
    entryPath: row.entry_path, exitPath: row.exit_path })), users: userResult.rows.map(row => ({
      customerReference: row.customer_reference, loginCount: number(row.login_count),
      firstLogin: row.first_login, lastLogin: row.last_login })) };
}

async function returns(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`SELECT rr.id, rr.return_number, rr.status, rr.refund_status,
      rr.refund_amount, rr.requested_at, rr.received_at, rr.refunded_at, o.order_number,
      SUBSTRING(MD5(rr.user_id::text),1,10) AS customer_reference
    FROM return_requests rr JOIN orders o ON o.id=rr.order_id
    WHERE rr.requested_at >= $1 AND rr.requested_at < $2
    ORDER BY rr.requested_at DESC LIMIT 100`, [period.start, period.end]);
  const values = rows.map(row => ({ id: row.id, returnNumber: row.return_number, orderNumber: row.order_number,
    customerReference: row.customer_reference, status: row.status, refundStatus: row.refund_status,
    refundAmount: number(row.refund_amount), requestedAt: row.requested_at,
    receivedAt: row.received_at, refundedAt: row.refunded_at }));
  return { period, summary: {
    requested: values.length,
    received: values.filter(item => ['received','approved','refund_initiated','refunded'].includes(item.status)).length,
    completed: values.filter(item => item.status === 'refunded').length,
    failedOrCancelled: values.filter(item => ['shiprocket_failed','pickup_failed','cancelled','rejected'].includes(item.status)).length,
    refundedAmount: values.filter(item => item.refundStatus === 'refunded').reduce((sum, item) => sum + item.refundAmount, 0)
  }, returns: values };
}

async function errors(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`SELECT e.occurred_at, e.path, e.metadata,
      SUBSTRING(MD5(s.visitor_id::text),1,10) AS visitor_reference
    FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
    WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.event_type='FRONTEND_ERROR'
    ORDER BY e.occurred_at DESC LIMIT 100`, [period.start, period.end]);
  return { period, errors: rows.map(row => ({ occurredAt: row.occurred_at, path: row.path,
    visitorReference: row.visitor_reference, message: row.metadata?.message || 'Browser error',
    source: row.metadata?.source || 'window' })) };
}

async function trend(query) {
  const period = resolvePeriod(query);
  const { rows } = await pool.query(`WITH days AS (
      SELECT generate_series($1::date,$2::date,INTERVAL '1 day')::date AS day
    ), session_daily AS (
      SELECT (started_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS sessions,
        COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END)::int AS visitors, COALESCE(SUM(page_views),0)::int AS page_views,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS logged_in_visitors,
        COUNT(DISTINCT visitor_id) FILTER (WHERE user_id IS NULL)::int AS anonymous_visitors,
        COUNT(DISTINCT CASE WHEN user_id IS NULL THEN 'visitor:'||visitor_id::text ELSE 'user:'||user_id::text END) FILTER (WHERE (SELECT MIN(first.started_at AT TIME ZONE $3)::date
          FROM analytics_sessions first WHERE (CASE WHEN first.user_id IS NULL THEN 'visitor:'||first.visitor_id::text ELSE 'user:'||first.user_id::text END)
          =(CASE WHEN analytics_sessions.user_id IS NULL THEN 'visitor:'||analytics_sessions.visitor_id::text ELSE 'user:'||analytics_sessions.user_id::text END) AND NOT first.is_internal)
          = (started_at AT TIME ZONE $3)::date)::int AS new_visitors,
        COALESCE(SUM(product_views),0)::int AS product_views, COALESCE(SUM(active_seconds),0)::int AS total_active_seconds,
        COALESCE(AVG(active_seconds),0) AS average_session_seconds
      FROM analytics_sessions WHERE started_at >= $4 AND started_at < $5 AND NOT is_internal GROUP BY 1
    ), event_daily AS (
      SELECT (e.occurred_at AT TIME ZONE $3)::date AS day,
        COUNT(*) FILTER (WHERE event_type='ADD_TO_CART')::int AS add_to_carts,
        COUNT(*) FILTER (WHERE event_type='REMOVE_FROM_CART')::int AS remove_from_carts,
        COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE event_type='CHECKOUT_STARTED')::int AS checkout_started,
        COUNT(*) FILTER (WHERE event_type='FRONTEND_ERROR')::int AS frontend_errors,
        COUNT(DISTINCT e.session_id) FILTER (WHERE event_type='FRONTEND_ERROR')::int AS affected_error_sessions,
        COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE event_type='PRODUCT_VIEWED')::int AS unique_product_viewers,
        COUNT(DISTINCT e.product_id) FILTER (WHERE event_type='PRODUCT_VIEWED')::int AS products_viewed,
        COUNT(DISTINCT CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END) FILTER (WHERE event_type='ADD_TO_CART')::int AS add_to_cart_visitors,
        COUNT(DISTINCT e.user_id) FILTER (WHERE event_type='LOGIN')::int AS unique_users_logged_in,
        COUNT(*) FILTER (WHERE event_type='LOGIN')::int AS login_events,
        COUNT(*) FILTER (WHERE event_type='SIGNUP')::int AS signups
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $4 AND e.occurred_at < $5 GROUP BY 1
    ), order_daily AS (
      SELECT (created_at AT TIME ZONE $3)::date AS day,
        COUNT(*) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
          OR (payment_method='cod' AND payment_status='pending')))::int AS orders_placed,
        COUNT(*) FILTER (WHERE payment_status IN ('paid','refunded','partially_refunded'))::int AS successful_orders,
        COUNT(DISTINCT user_id) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
          OR (payment_method='cod' AND payment_status='pending')))::int AS unique_purchasers,
        COALESCE(SUM(total_amount) FILTER (WHERE order_status<>'cancelled' AND (payment_status IN ('paid','refunded','partially_refunded')
          OR (payment_method='cod' AND payment_status='pending'))),0) AS gross_order_value
      FROM orders WHERE order_type = 'normal' AND created_at >= $4 AND created_at < $5 GROUP BY 1
    ), login_by_day AS (
      SELECT (e.occurred_at AT TIME ZONE $3)::date AS day,e.user_id,COUNT(*) AS login_count
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      WHERE e.occurred_at >= $4 AND e.occurred_at < $5 AND e.event_type='LOGIN' GROUP BY 1,2
    ), repeat_login_daily AS (
      SELECT day,COUNT(*) FILTER (WHERE login_count>1)::int AS repeat_login_users FROM login_by_day GROUP BY day
    ), payment_daily AS (
      SELECT (attempted_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS payment_attempts,
        COUNT(*) FILTER (WHERE status='successful')::int AS payment_successes,
        COUNT(*) FILTER (WHERE status='failed')::int AS payment_failures
      FROM payment_attempts WHERE attempted_at >= $4 AND attempted_at < $5 GROUP BY 1
    ), money_daily AS (
      SELECT (occurred_at AT TIME ZONE $3)::date AS day,
        COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT' AND status='SUCCESS'),0) AS gross_revenue,
        COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT' AND status='SUCCESS'),0) AS refunds,
        COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT' AND status='PENDING'),0) AS pending_refunds
      FROM financial_transactions WHERE occurred_at >= $4 AND occurred_at < $5 GROUP BY 1
    ), return_daily AS (
      SELECT (requested_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS return_requests,
        COUNT(*) FILTER (WHERE status='refunded')::int AS completed_returns,
        COUNT(*) FILTER (WHERE refund_status IN ('processing','refunded'))::int AS refunds_initiated,
        COUNT(*) FILTER (WHERE refund_status='refunded')::int AS refunds_completed
      FROM return_requests WHERE requested_at >= $4 AND requested_at < $5 GROUP BY 1
    ), cart_activity AS (
      SELECT c.id,c.status,c.created_at,GREATEST(c.created_at,COALESCE(MAX(ci.updated_at),c.created_at)) AS last_activity,
        COALESCE(SUM(ci.quantity),0)::int AS quantity
      FROM carts c LEFT JOIN cart_items ci ON ci.cart_id=c.id GROUP BY c.id
    ), cart_daily AS (
      SELECT (created_at AT TIME ZONE $3)::date AS day,COUNT(*)::int AS carts_used,
        COUNT(*) FILTER (WHERE status='active' AND quantity>0 AND last_activity<NOW()-INTERVAL '24 hours')::int AS abandoned
      FROM cart_activity WHERE created_at >= $4 AND created_at < $5 GROUP BY 1
    ) SELECT days.day, COALESCE(s.sessions,0) AS sessions, COALESCE(s.visitors,0) AS visitors,
      COALESCE(s.page_views,0) AS page_views, COALESCE(s.product_views,0) AS product_views,
      COALESCE(s.logged_in_visitors,0) AS logged_in_visitors, COALESCE(s.anonymous_visitors,0) AS anonymous_visitors,
      COALESCE(s.new_visitors,0) AS new_visitors,
      COALESCE(s.average_session_seconds,0) AS average_session_seconds,
      COALESCE(s.total_active_seconds,0) AS total_active_seconds,
      COALESCE(e.add_to_carts,0) AS add_to_carts, COALESCE(e.remove_from_carts,0) AS remove_from_carts,
      COALESCE(e.checkout_started,0) AS checkout_started, COALESCE(e.frontend_errors,0) AS frontend_errors,
      COALESCE(e.login_events,0) AS login_events, COALESCE(e.signups,0) AS signups,
      COALESCE(e.unique_users_logged_in,0) AS unique_users_logged_in,
      COALESCE(rl.repeat_login_users,0) AS repeat_login_users,
      COALESCE(e.unique_product_viewers,0) AS unique_product_viewers, COALESCE(e.products_viewed,0) AS products_viewed,
      COALESCE(e.add_to_cart_visitors,0) AS add_to_cart_visitors, COALESCE(e.affected_error_sessions,0) AS affected_error_sessions,
      COALESCE(o.orders_placed,0) AS orders_placed, COALESCE(o.successful_orders,0) AS successful_orders,
      COALESCE(o.unique_purchasers,0) AS unique_purchasers,
      COALESCE(o.gross_order_value,0) AS gross_order_value, COALESCE(p.payment_attempts,0) AS payment_attempts,
      COALESCE(p.payment_successes,0) AS payment_successes, COALESCE(p.payment_failures,0) AS payment_failures,
      COALESCE(m.gross_revenue,0) AS gross_revenue, COALESCE(m.refunds,0) AS refunds,
      COALESCE(m.pending_refunds,0) AS pending_refunds, COALESCE(r.return_requests,0) AS return_requests,
      COALESCE(r.completed_returns,0) AS completed_returns, COALESCE(r.refunds_initiated,0) AS refunds_initiated,
      COALESCE(r.refunds_completed,0) AS refunds_completed, COALESCE(c.carts_used,0) AS carts_used,
      COALESCE(c.abandoned,0) AS abandoned_carts
    FROM days LEFT JOIN session_daily s USING(day) LEFT JOIN event_daily e USING(day)
      LEFT JOIN order_daily o USING(day) LEFT JOIN repeat_login_daily rl USING(day) LEFT JOIN payment_daily p USING(day)
      LEFT JOIN money_daily m USING(day) LEFT JOIN return_daily r USING(day) LEFT JOIN cart_daily c USING(day) ORDER BY days.day`,
  [period.startDate, period.endDate, BUSINESS_TIME_ZONE, period.start, period.end]);
  return { period, points: rows.map(row => {
    const visitors = number(row.visitors); const orders = number(row.successful_orders);
    const attempts = number(row.payment_attempts); const gross = number(row.gross_revenue); const refundsValue = number(row.refunds);
    return { date: row.day, visitors, newVisitors: number(row.new_visitors),
      returningVisitors: Math.max(0, visitors-number(row.new_visitors)), loggedInVisitors: number(row.logged_in_visitors),
      anonymousVisitors: number(row.anonymous_visitors), loginEvents: number(row.login_events), signups: number(row.signups),
      uniqueUsersLoggedIn: number(row.unique_users_logged_in), repeatLoginUsers: number(row.repeat_login_users),
      sessions: number(row.sessions), pageViews: number(row.page_views), totalActiveSeconds: number(row.total_active_seconds),
      productViews: number(row.product_views), addToCarts: number(row.add_to_carts), removeFromCarts: number(row.remove_from_carts),
      uniqueProductViewers: number(row.unique_product_viewers), productsViewed: number(row.products_viewed),
      addToCartVisitors: number(row.add_to_cart_visitors),
      checkoutStarted: number(row.checkout_started), paymentAttempts: attempts, paymentSuccesses: number(row.payment_successes),
      paymentFailures: number(row.payment_failures), ordersPlaced: number(row.orders_placed), successfulOrders: orders,
      uniquePurchasers: number(row.unique_purchasers),
      grossOrderValue: number(row.gross_order_value), grossRevenue: gross, refunds: refundsValue,
      pendingRefunds: number(row.pending_refunds), revenue: gross-refundsValue,
      conversionRate: rate(number(row.unique_purchasers), visitors), averageOrderValue: orders ? Number(((gross-refundsValue)/orders).toFixed(2)) : 0,
      cartAbandonmentRate: rate(number(row.abandoned_carts), number(row.carts_used)),
      checkoutAbandonmentRate: rate(Math.max(0,number(row.checkout_started)-orders),number(row.checkout_started)),
      paymentSuccessRate: rate(number(row.payment_successes), attempts), paymentFailureRate: rate(number(row.payment_failures), attempts),
      averageSessionSeconds: number(row.average_session_seconds),
      averagePageViewsPerSession: number(row.sessions) ? Number((number(row.page_views)/number(row.sessions)).toFixed(2)) : 0,
      returnRequests: number(row.return_requests), completedReturns: number(row.completed_returns),
      returnRate: rate(number(row.return_requests),orders),
      refundsInitiated: number(row.refunds_initiated), refundsCompleted: number(row.refunds_completed),
      frontendErrors: number(row.frontend_errors), affectedErrorSessions: number(row.affected_error_sessions),
      errorRate: rate(number(row.affected_error_sessions),number(row.sessions)) };
  }) };
}

const DRILLDOWN_METRICS = new Set(Object.keys(KPI_DEFINITIONS));
async function drilldown(query) {
  if (!DRILLDOWN_METRICS.has(query.metric)) throw httpError(400, 'Invalid analytics metric.');
  if (!validDate(query.date)) throw httpError(400, 'A valid analytics date is required.');
  const start = midnightUtc(query.date);
  const end = midnightUtc(addDays(query.date, 1));
  const metricName = query.metric;
  const traffic = new Set(['visitors','newVisitors','returningVisitors','loggedInVisitors','anonymousVisitors','sessions',
    'pageViews','averageSessionSeconds','totalActiveSeconds','averagePageViewsPerSession']);
  const customer = new Set(['uniqueUsersLoggedIn','loginEvents','repeatLoginUsers','signups']);
  const product = new Set(['productViews','uniqueProductViewers','productsViewed','addToCarts','addToCartVisitors','removeFromCarts',
    'cartAbandonmentRate','checkoutStarted','checkoutAbandonmentRate']);
  const order = new Set(['ordersPlaced','successfulOrders','uniquePurchasers','grossOrderValue','conversionRate','averageOrderValue']);
  const money = new Set(['grossRevenue','refunds','pendingRefunds','revenue']);
  const payment = new Set(['paymentAttempts','paymentSuccesses','paymentFailures','paymentSuccessRate','paymentFailureRate']);
  const returnsSet = new Set(['returnRequests','completedReturns','returnRate','refundsInitiated','refundsCompleted']);
  let result;
  let columns;
  if (traffic.has(metricName)) {
    const identity = `CASE WHEN s.user_id IS NULL THEN 'visitor:'||s.visitor_id::text ELSE 'user:'||s.user_id::text END`;
    const historicalIdentity = `CASE WHEN old.user_id IS NULL THEN 'visitor:'||old.visitor_id::text ELSE 'user:'||old.user_id::text END`;
    const audience = metricName === 'newVisitors'
      ? `AND NOT EXISTS(SELECT 1 FROM analytics_sessions old WHERE ${historicalIdentity}=${identity} AND old.started_at<$1 AND NOT old.is_internal)`
      : metricName === 'returningVisitors'
        ? `AND EXISTS(SELECT 1 FROM analytics_sessions old WHERE ${historicalIdentity}=${identity} AND old.started_at<$1 AND NOT old.is_internal)`
        : '';
    result = await pool.query(`SELECT SUBSTRING(MD5(MIN(s.visitor_id::text)),1,10) AS visitor_reference,
        COALESCE(u.name,'Guest') AS customer, COALESCE(u.email,'—') AS email,
        CASE WHEN s.user_id IS NULL THEN 'Guest' ELSE 'Authenticated' END AS visitor_type,
        COUNT(*)::int AS sessions, SUM(s.page_views)::int AS page_views, SUM(s.product_views)::int AS product_views,
        SUM(s.active_seconds)::int AS active_seconds, MIN(s.started_at) AS first_seen,
        MAX(s.last_activity_at) AS last_seen, MIN(s.entry_path) AS entry_page, MAX(s.exit_path) AS exit_page
      FROM analytics_sessions s LEFT JOIN users u ON u.id=s.user_id
      WHERE s.started_at >= $1 AND s.started_at < $2 AND NOT s.is_internal ${audience}
      GROUP BY ${identity},u.name,u.email,s.user_id ORDER BY last_seen DESC LIMIT 250`, [start,end]);
    columns = [['visitor_reference','Visitor ref'],['customer','Customer'],['email','Email'],['visitor_type','Type'],
      ['sessions','Sessions'],['page_views','Page views'],['product_views','Product views'],['active_seconds','Active seconds'],
      ['first_seen','First seen'],['last_seen','Last seen'],['entry_page','Entry'],['exit_page','Exit']];
  } else if (customer.has(metricName)) {
    result = await pool.query(`SELECT COALESCE(u.name,'Customer') AS customer,u.email,
        SUBSTRING(MD5(e.user_id::text),1,10) AS customer_reference,e.event_type,
        COUNT(*)::int AS event_count,MIN(e.occurred_at) AS first_event,MAX(e.occurred_at) AS last_event
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      LEFT JOIN users u ON u.id=e.user_id WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        AND e.event_type IN ('LOGIN','SIGNUP') GROUP BY u.name,u.email,e.user_id,e.event_type
      ORDER BY last_event DESC LIMIT 250`, [start,end]);
    columns = [['customer','Customer'],['email','Email'],['customer_reference','Customer ref'],['event_type','Event'],
      ['event_count','Count'],['first_event','First'],['last_event','Last']];
  } else if (product.has(metricName)) {
    result = await pool.query(`SELECT e.occurred_at,COALESCE(u.name,'Guest') AS customer,COALESCE(u.email,'—') AS email,
        SUBSTRING(MD5(s.visitor_id::text),1,10) AS visitor_reference,e.event_type,p.name AS product,e.path
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      LEFT JOIN users u ON u.id=e.user_id LEFT JOIN products p ON p.id=e.product_id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2 AND e.event_type IN
        ('PRODUCT_VIEWED','ADD_TO_CART','REMOVE_FROM_CART','CHECKOUT_STARTED')
      ORDER BY e.occurred_at DESC LIMIT 250`, [start,end]);
    columns = [['occurred_at','Time'],['customer','Customer'],['email','Email'],['visitor_reference','Visitor ref'],
      ['event_type','Action'],['product','Product'],['path','Page']];
  } else if (order.has(metricName)) {
    const orderFilter = metricName === 'successfulOrders'
      ? "o.payment_status IN ('paid','refunded','partially_refunded')"
      : "o.order_status<>'cancelled' AND (o.payment_status IN ('paid','refunded','partially_refunded') OR (o.payment_method='cod' AND o.payment_status='pending'))";
    result = await pool.query(`SELECT o.order_number,u.name AS customer,u.email,o.total_amount,o.payment_method,
        o.payment_status,o.order_status,o.created_at
      FROM orders o JOIN users u ON u.id=o.user_id WHERE o.order_type = 'normal' AND o.created_at >= $1 AND o.created_at < $2
        AND ${orderFilter}
      ORDER BY o.created_at DESC LIMIT 250`, [start,end]);
    columns = [['order_number','Order'],['customer','Customer'],['email','Email'],['total_amount','Amount'],
      ['payment_method','Method'],['payment_status','Payment'],['order_status','Order status'],['created_at','Created']];
  } else if (money.has(metricName)) {
    result = await pool.query(`SELECT ft.occurred_at,o.order_number,u.name AS customer,u.email,ft.transaction_type,
        ft.direction,ft.amount,ft.status,ft.payment_method,ft.description
      FROM financial_transactions ft JOIN orders o ON o.id=ft.order_id JOIN users u ON u.id=o.user_id
      WHERE ft.occurred_at >= $1 AND ft.occurred_at < $2 ORDER BY ft.occurred_at DESC LIMIT 250`, [start,end]);
    columns = [['occurred_at','Time'],['order_number','Order'],['customer','Customer'],['email','Email'],
      ['transaction_type','Transaction'],['direction','Direction'],['amount','Amount'],['status','Status'],
      ['payment_method','Method'],['description','Description']];
  } else if (payment.has(metricName)) {
    result = await pool.query(`SELECT pa.attempted_at,o.order_number,u.name AS customer,u.email,o.total_amount,
        o.payment_method,pa.status,COALESCE(pa.failure_category,'—') AS failure_category,
        SUBSTRING(MD5(pa.gateway_payment_id),1,12) AS provider_reference
      FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id JOIN users u ON u.id=o.user_id
      WHERE pa.attempted_at >= $1 AND pa.attempted_at < $2 ORDER BY pa.attempted_at DESC LIMIT 250`, [start,end]);
    columns = [['attempted_at','Time'],['order_number','Order'],['customer','Customer'],['email','Email'],
      ['total_amount','Amount'],['payment_method','Method'],['status','Status'],['failure_category','Failure'],
      ['provider_reference','Provider ref']];
  } else if (returnsSet.has(metricName)) {
    result = await pool.query(`SELECT rr.requested_at,rr.return_number,o.order_number,u.name AS customer,u.email,
        rr.status,rr.refund_status,rr.refund_amount,rr.reason
      FROM return_requests rr JOIN orders o ON o.id=rr.order_id JOIN users u ON u.id=rr.user_id
      WHERE rr.requested_at >= $1 AND rr.requested_at < $2 ORDER BY rr.requested_at DESC LIMIT 250`, [start,end]);
    columns = [['requested_at','Requested'],['return_number','Return'],['order_number','Order'],['customer','Customer'],
      ['email','Email'],['status','Return status'],['refund_status','Refund status'],['refund_amount','Amount'],['reason','Reason']];
  } else {
    result = await pool.query(`SELECT e.occurred_at,COALESCE(u.name,'Guest') AS customer,COALESCE(u.email,'—') AS email,
        SUBSTRING(MD5(s.visitor_id::text),1,10) AS visitor_reference,e.path,e.metadata->>'category' AS category,
        e.metadata->>'message' AS message
      FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id AND NOT s.is_internal
      LEFT JOIN users u ON u.id=e.user_id WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        AND e.event_type='FRONTEND_ERROR' ORDER BY e.occurred_at DESC LIMIT 250`, [start,end]);
    columns = [['occurred_at','Time'],['customer','Customer'],['email','Email'],['visitor_reference','Visitor ref'],
      ['path','Page'],['category','Category'],['message','Message']];
  }
  return { metric: metricName,date: query.date,definition: KPI_DEFINITIONS[metricName],columns: columns.map(([key,label])=>({key,label})),rows: result.rows };
}

module.exports = { BUSINESS_TIME_ZONE, KPI_DEFINITIONS, resolvePeriod, aggregate, overview, revenue, funnel,
  products, carts, payments, visitors, logins, returns, errors, trend, drilldown };
