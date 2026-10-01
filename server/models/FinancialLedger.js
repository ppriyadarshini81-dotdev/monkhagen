const { pool } = require('../config/db');

const VALUES = {
  type: new Set(['PAYMENT', 'COD_PAYMENT', 'REFUND', 'ADJUSTMENT']),
  direction: new Set(['CREDIT', 'DEBIT']),
  status: new Set(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']),
  paymentMethod: new Set(['RAZORPAY', 'COD', 'MANUAL'])
};
const SORTS = {
  date: 'ft.occurred_at', order: 'o.order_number', amount: 'ft.amount',
  status: 'ft.status', type: 'ft.transaction_type'
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }
function validDate(value) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function enumValue(value, key) {
  if (!value) return null;
  const upper = String(value).toUpperCase();
  if (!VALUES[key].has(upper)) throw invalid(`Invalid ledger ${key} filter.`);
  return upper;
}
function filters(query = {}) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || ![25, 50, 100].includes(pageSize)) {
    throw invalid('Invalid ledger pagination.');
  }
  const dateFrom = query.dateFrom || null;
  const dateTo = query.dateTo || null;
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
    throw invalid('Invalid ledger date range.');
  }
  const search = String(query.search || '').trim();
  if (search.length > 120) throw invalid('Ledger search is too long.');
  const sortBy = query.sortBy || 'date';
  const sortDirection = String(query.sortDirection || 'desc').toLowerCase();
  if (!SORTS[sortBy] || !['asc', 'desc'].includes(sortDirection)) throw invalid('Invalid ledger sorting.');
  return {
    page, pageSize, search, dateFrom, dateTo, sortBy, sortDirection,
    type: enumValue(query.type, 'type'), direction: enumValue(query.direction, 'direction'),
    status: enumValue(query.status, 'status'), paymentMethod: enumValue(query.paymentMethod, 'paymentMethod')
  };
}

function where(filter) {
  const clauses = [];
  const values = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (filter.dateFrom) add("ft.occurred_at >= (?::date::timestamp AT TIME ZONE 'Asia/Kolkata')", filter.dateFrom);
  if (filter.dateTo) add("ft.occurred_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')", filter.dateTo);
  if (filter.type) add('ft.transaction_type = ?', filter.type);
  if (filter.direction) add('ft.direction = ?', filter.direction);
  if (filter.status) add('ft.status = ?', filter.status);
  if (filter.paymentMethod) add('ft.payment_method = ?', filter.paymentMethod);
  if (filter.search) {
    values.push(`%${filter.search.replace(/[\\%_]/g, '\\$&')}%`);
    const p = `$${values.length}`;
    clauses.push(`(o.order_number ILIKE ${p} ESCAPE '\\' OR rr.return_number ILIKE ${p} ESCAPE '\\'
      OR COALESCE(u.name, oa.full_name, '') ILIKE ${p} ESCAPE '\\' OR COALESCE(u.email, '') ILIKE ${p} ESCAPE '\\'
      OR COALESCE(oa.phone, u.phone, '') ILIKE ${p} ESCAPE '\\' OR COALESCE(ft.provider_reference_id, '') ILIKE ${p} ESCAPE '\\')`);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

const joins = `FROM financial_transactions ft
  JOIN orders o ON o.id = ft.order_id
  JOIN users u ON u.id = o.user_id
  LEFT JOIN order_addresses oa ON oa.order_id = o.id
  LEFT JOIN return_requests rr ON rr.id = ft.return_id`;
const columns = `ft.id, ft.order_id, o.order_number, NULL::text AS invoice_number,
  COALESCE(NULLIF(oa.full_name, ''), u.name) AS customer_name, u.email AS customer_email,
  COALESCE(oa.phone, u.phone) AS customer_phone, ft.return_id, rr.return_number,
  ft.transaction_type, ft.direction, ft.amount, ft.currency, ft.status, ft.payment_method,
  ft.provider, ft.provider_reference_id, ft.description, ft.occurred_at, ft.created_at, ft.updated_at`;

function format(row) {
  return {
    id: row.id, orderId: row.order_id, orderNumber: row.order_number,
    invoiceNumber: row.invoice_number || null,
    customer: { name: row.customer_name || null, email: row.customer_email || null, phone: row.customer_phone || null },
    returnId: row.return_id || null, returnNumber: row.return_number || null,
    type: row.transaction_type, direction: row.direction, amount: Number(row.amount), currency: row.currency,
    status: row.status, paymentMethod: row.payment_method, provider: row.provider,
    providerReferenceId: row.provider_reference_id || null, description: row.description,
    occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.events ? { events: row.events } : {})
  };
}

async function list(query = {}, database = pool) {
  const filter = filters(query);
  const clause = where(filter);
  const count = await database.query(`SELECT COUNT(*)::integer AS count ${joins} ${clause.sql}`, clause.values);
  const values = [...clause.values, filter.pageSize, (filter.page - 1) * filter.pageSize];
  const result = await database.query(
    `SELECT ${columns} ${joins} ${clause.sql}
     ORDER BY ${SORTS[filter.sortBy]} ${filter.sortDirection.toUpperCase()}, ft.id ${filter.sortDirection.toUpperCase()}
     LIMIT $${values.length - 1} OFFSET $${values.length}`, values
  );
  const total = count.rows[0]?.count || 0;
  return { transactions: result.rows.map(format), pagination: {
    page: filter.page, pageSize: filter.pageSize, total, pages: Math.max(1, Math.ceil(total / filter.pageSize))
  } };
}

async function summary(query = {}, database = pool) {
  const filter = filters({ ...query, page: 1, pageSize: 25 });
  const clause = where(filter);
  const result = await database.query(
    `SELECT
       COALESCE(SUM(ft.amount) FILTER (WHERE ft.direction = 'CREDIT' AND ft.status = 'SUCCESS'), 0) AS successful_credits,
       COALESCE(SUM(ft.amount) FILTER (WHERE ft.direction = 'DEBIT' AND ft.status = 'SUCCESS'), 0) AS successful_debits,
       COALESCE(SUM(ft.amount) FILTER (WHERE ft.transaction_type = 'REFUND' AND ft.direction = 'DEBIT' AND ft.status = 'PENDING'), 0) AS pending_refunds,
       COUNT(*) FILTER (WHERE ft.status = 'FAILED')::integer AS failed_count
     ${joins} ${clause.sql}`, clause.values
  );
  const row = result.rows[0] || {};
  const credits = Number(row.successful_credits || 0);
  const debits = Number(row.successful_debits || 0);
  return { successfulCredits: credits, successfulDebits: debits,
    netSuccessfulAmount: Number((credits - debits).toFixed(2)), pendingRefunds: Number(row.pending_refunds || 0),
    failedTransactionCount: Number(row.failed_count || 0) };
}

async function all(query = {}, database = pool) {
  const filter = filters({ ...query, page: 1, pageSize: 100 });
  const clause = where(filter);
  const result = await database.query(
    `SELECT ${columns} ${joins} ${clause.sql}
     ORDER BY ${SORTS[filter.sortBy]} ${filter.sortDirection.toUpperCase()}, ft.id ${filter.sortDirection.toUpperCase()}
     LIMIT 50000`, clause.values
  );
  return result.rows.map(format);
}

async function findById(id, database = pool) {
  const result = await database.query(
    `SELECT ${columns}, COALESCE((SELECT json_agg(json_build_object(
       'previousStatus', e.previous_status, 'newStatus', e.new_status, 'eventType', e.event_type,
       'providerEventId', e.provider_event_id, 'createdAt', e.created_at) ORDER BY e.created_at, e.id)
       FROM financial_transaction_events e WHERE e.transaction_id = ft.id), '[]'::json) AS events
     ${joins} WHERE ft.id = $1`, [id]
  );
  return result.rows[0] ? format(result.rows[0]) : null;
}

module.exports = { filters, where, list, summary, all, findById };
