const { pool } = require('../config/db');
const { UUID } = require('../middleware/validation');

const CLIENT_EVENTS = new Set([
  'PAGE_VIEW', 'PRODUCT_VIEWED', 'CART_VIEWED', 'CHECKOUT_STARTED',
  'ADDRESS_SELECTED', 'PAYMENT_WINDOW_CLOSED'
]);
const SERVER_EVENTS = new Set([
  'ADD_TO_CART', 'REMOVE_FROM_CART', 'PAYMENT_STARTED', 'PAYMENT_SUCCESS',
  'PAYMENT_FAILED', 'ORDER_CREATED', 'LOGIN', 'SIGNUP'
]);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function cleanPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.split(/[?#]/, 1)[0].trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 512 || /[\u0000-\u001f]/.test(path)) return null;
  return path;
}

function sessionIdFromRequest(req) {
  const value = req.get('x-mh-analytics-session');
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

async function ensureSession({ sessionId, visitorId, entryPath = '/', userId = null }, database = pool) {
  if (!UUID.test(sessionId || '') || !UUID.test(visitorId || '')) throw httpError(400, 'Invalid analytics session.');
  const normalizedPath = cleanPath(entryPath) || '/';
  const { rows } = await database.query(`
    INSERT INTO analytics_sessions
      (id, visitor_id, user_id, entry_path, is_authenticated_at_start)
    VALUES ($1,$2,$3,$4,$3::uuid IS NOT NULL)
    ON CONFLICT (id) DO UPDATE SET
      user_id = COALESCE(analytics_sessions.user_id, EXCLUDED.user_id),
      last_activity_at = NOW()
    WHERE analytics_sessions.visitor_id = EXCLUDED.visitor_id
      AND (analytics_sessions.user_id IS NULL OR EXCLUDED.user_id IS NULL
        OR analytics_sessions.user_id = EXCLUDED.user_id)
    RETURNING id`, [sessionId, visitorId, userId, normalizedPath]);
  if (!rows[0]) throw httpError(409, 'Analytics session is unavailable.');
  await database.query(`
    INSERT INTO analytics_events (dedupe_key, session_id, user_id, event_type, path)
    VALUES ($1,$2,$3,'SESSION_STARTED',$4)
    ON CONFLICT (dedupe_key) DO NOTHING`, [`session:${sessionId}:started`, sessionId, userId, normalizedPath]);
  return rows[0];
}

async function touchSession({ sessionId, visitorId, ended = false, userId = null }) {
  if (!UUID.test(sessionId || '') || !UUID.test(visitorId || '')) throw httpError(400, 'Invalid analytics session.');
  const { rowCount } = await pool.query(`UPDATE analytics_sessions
    SET user_id = COALESCE(user_id, $3), last_activity_at = NOW(),
        ended_at = CASE WHEN $4 THEN NOW() ELSE ended_at END
    WHERE id = $1 AND visitor_id = $2`, [sessionId, visitorId, userId, Boolean(ended)]);
  if (!rowCount) throw httpError(404, 'Analytics session not found.');
}

async function ingestEvents({ sessionId, visitorId, events, userId = null }) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 25) {
    throw httpError(400, 'Analytics events must contain between 1 and 25 items.');
  }
  const normalized = events.map(event => {
    if (!event || typeof event !== 'object' || !UUID.test(event.eventId || '') || !CLIENT_EVENTS.has(event.type)) {
      throw httpError(400, 'Invalid analytics event.');
    }
    const path = cleanPath(event.path);
    if (!path) throw httpError(400, 'Invalid analytics path.');
    if (event.productId != null && !UUID.test(event.productId)) throw httpError(400, 'Invalid analytics product.');
    return { id: event.eventId, type: event.type, path, productId: event.productId || null };
  });
  await ensureSession({ sessionId, visitorId, entryPath: events[0]?.path || '/', userId });

  const client = await pool.connect();
  let pageViews = 0;
  let productViews = 0;
  try {
    await client.query('BEGIN');
    for (const event of normalized) {
      const result = await client.query(`INSERT INTO analytics_events
        (id, session_id, user_id, event_type, path, product_id)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING`, [event.id, sessionId, userId, event.type, event.path, event.productId]);
      if (result.rowCount) {
        if (event.type === 'PAGE_VIEW') pageViews += 1;
        if (event.type === 'PRODUCT_VIEWED') productViews += 1;
      }
    }
    await client.query(`UPDATE analytics_sessions SET
      user_id = COALESCE(user_id, $2), last_activity_at = NOW(), ended_at = NULL,
      page_views = page_views + $3, product_views = product_views + $4
      WHERE id = $1`, [sessionId, userId, pageViews, productViews]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordServerEvent(req, eventType, references = {}) {
  if (!SERVER_EVENTS.has(eventType)) return;
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) return;
  const userId = req.user?.id || references.userId || null;
  try {
    const session = await pool.query(`SELECT id FROM analytics_sessions WHERE id = $1
      AND (user_id IS NULL OR $2::uuid IS NULL OR user_id = $2)`, [sessionId, userId]);
    if (!session.rows[0]) return;
    const dedupeKey = references.dedupeKey || null;
    await pool.query(`INSERT INTO analytics_events
      (dedupe_key, session_id, user_id, event_type, product_id, cart_id, order_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (dedupe_key) DO NOTHING`, [dedupeKey, sessionId, userId, eventType,
        references.productId || null, references.cartId || null, references.orderId || null]);
    await pool.query(`UPDATE analytics_sessions SET user_id = COALESCE(user_id, $2),
      last_activity_at = NOW() WHERE id = $1`, [sessionId, userId]);
  } catch (error) {
    console.warn('Analytics event was not recorded.', { code: error.code || 'ANALYTICS_WRITE_FAILED' });
  }
}

async function linkOrderSession(req, orderId) {
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId || !UUID.test(orderId || '') || !req.user?.id) return;
  try {
    await pool.query(`UPDATE orders o SET analytics_session_id = s.id
      FROM analytics_sessions s
      WHERE o.id = $1 AND o.user_id = $2 AND s.id = $3
        AND (s.user_id IS NULL OR s.user_id = $2)`, [orderId, req.user.id, sessionId]);
  } catch (error) {
    console.warn('Analytics order link was not recorded.', { code: error.code || 'ANALYTICS_LINK_FAILED' });
  }
}

async function recordOrderEvent(order, eventType, dedupeSuffix) {
  if (!order?.analytics_session_id || !SERVER_EVENTS.has(eventType)) return;
  try {
    await pool.query(`INSERT INTO analytics_events
      (dedupe_key, session_id, user_id, event_type, order_id)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING`,
    [`${dedupeSuffix}:${order.id}`, order.analytics_session_id, order.user_id, eventType, order.id]);
  } catch (error) {
    console.warn('Analytics order event was not recorded.', { code: error.code || 'ANALYTICS_ORDER_EVENT_FAILED' });
  }
}

module.exports = {
  CLIENT_EVENTS,
  cleanPath,
  ensureSession,
  touchSession,
  ingestEvents,
  recordServerEvent,
  recordOrderEvent,
  linkOrderSession,
  sessionIdFromRequest
};
