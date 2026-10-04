const { pool } = require('../config/db');
const { UUID } = require('../middleware/validation');

const CLIENT_EVENTS = new Set([
  'PAGE_VIEW', 'PRODUCT_VIEWED', 'CART_VIEWED', 'CHECKOUT_STARTED',
  'ADDRESS_SELECTED', 'PAYMENT_WINDOW_CLOSED', 'ADD_TO_CART',
  'REMOVE_FROM_CART', 'FRONTEND_ERROR'
]);
const SERVER_EVENTS = new Set([
  'ADD_TO_CART', 'REMOVE_FROM_CART', 'PAYMENT_STARTED', 'PAYMENT_SUCCESS',
  'PAYMENT_FAILED', 'ORDER_CREATED', 'LOGIN', 'SIGNUP', 'LOGOUT'
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

function cleanErrorText(value, max = 240) {
  if (typeof value !== 'string') return null;
  return value.replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[?&][^\s=]{1,40}=[^\s&]{1,200}/g, '[query]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

function cleanMetadata(event) {
  const input = event?.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
  if (event.type === 'FRONTEND_ERROR') {
    return {
      category: cleanErrorText(input.category, 80) || 'javascript_error',
      message: cleanErrorText(input.message) || 'Frontend error',
      ...(cleanErrorText(input.appVersion, 40) ? { appVersion: cleanErrorText(input.appVersion, 40) } : {})
    };
  }
  if (['ADD_TO_CART','REMOVE_FROM_CART'].includes(event.type)) {
    const quantity = Number(input.quantity);
    const estimatedValue = Number(input.estimatedValue);
    return {
      ...(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100 ? { quantity } : {}),
      ...(Number.isFinite(estimatedValue) && estimatedValue >= 0 && estimatedValue <= 1000000
        ? { estimatedValue: Math.round(estimatedValue * 100) / 100 } : {})
    };
  }
  return {};
}

async function ensureSession({ sessionId, visitorId, entryPath = '/', userId = null }, database = pool) {
  if (!UUID.test(sessionId || '') || !UUID.test(visitorId || '')) throw httpError(400, 'Invalid analytics session.');
  const normalizedPath = cleanPath(entryPath) || '/';
  const { rows } = await database.query(`
    INSERT INTO analytics_sessions
      (id, visitor_id, user_id, entry_path, is_authenticated_at_start, is_internal)
    VALUES ($1,$2,$3,$4,$3::uuid IS NOT NULL, EXISTS(
      SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.id=$3 AND r.name IN ('admin','super_admin')))
    ON CONFLICT (id) DO UPDATE SET
      user_id = COALESCE(analytics_sessions.user_id, EXCLUDED.user_id),
      is_internal = analytics_sessions.is_internal OR EXCLUDED.is_internal,
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

async function touchSession({ sessionId, visitorId, ended = false, userId = null, activeSeconds = 0, exitPath = null }, database = pool) {
  if (!UUID.test(sessionId || '') || !UUID.test(visitorId || '')) throw httpError(400, 'Invalid analytics session.');
  if (!Number.isSafeInteger(activeSeconds) || activeSeconds < 0 || activeSeconds > 60) throw httpError(400, 'Invalid analytics activity duration.');
  const normalizedExit = exitPath == null ? null : cleanPath(exitPath);
  if (exitPath != null && !normalizedExit) throw httpError(400, 'Invalid analytics exit path.');
  const { rowCount } = await database.query(`UPDATE analytics_sessions
    SET user_id = COALESCE(user_id, $3), last_activity_at = NOW(),
        ended_at = CASE WHEN $4 THEN NOW() ELSE ended_at END,
        exit_path = COALESCE($6, exit_path), active_seconds = active_seconds + $5,
        last_heartbeat_at = CASE WHEN $5 > 0 THEN NOW() ELSE last_heartbeat_at END,
        is_internal = is_internal OR EXISTS(SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
          WHERE u.id=$3 AND r.name IN ('admin','super_admin'))
    WHERE id = $1 AND visitor_id = $2`,
  [sessionId, visitorId, userId, Boolean(ended), activeSeconds, normalizedExit]);
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
    if (['ADD_TO_CART','REMOVE_FROM_CART'].includes(event.type) && userId) {
      throw httpError(400, 'Authenticated cart analytics must be recorded by the server.');
    }
    if (['ADD_TO_CART','REMOVE_FROM_CART'].includes(event.type) && !event.productId) {
      throw httpError(400, 'Cart analytics require a product.');
    }
    return { id: event.eventId, type: event.type, path, productId: event.productId || null,
      metadata: cleanMetadata(event) };
  });
  await ensureSession({ sessionId, visitorId, entryPath: events[0]?.path || '/', userId });

  const client = await pool.connect();
  let pageViews = 0;
  let productViews = 0;
  try {
    await client.query('BEGIN');
    for (const event of normalized) {
      const result = await client.query(`INSERT INTO analytics_events
        (id, session_id, user_id, event_type, path, product_id, metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO NOTHING`, [event.id, sessionId, userId, event.type, event.path, event.productId, event.metadata]);
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
      last_activity_at = NOW(), is_internal = is_internal OR EXISTS(
        SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.id=$2 AND r.name IN ('admin','super_admin')) WHERE id = $1`, [sessionId, userId]);
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
  cleanErrorText,
  cleanMetadata,
  ensureSession,
  touchSession,
  ingestEvents,
  recordServerEvent,
  recordOrderEvent,
  linkOrderSession,
  sessionIdFromRequest
};
