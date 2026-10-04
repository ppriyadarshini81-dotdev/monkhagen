const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const crypt = require('../services/codRefundCrypto');
const refunds = require('../services/codRefundService');

const RETURN = '20000000-0000-4000-8000-000000000001';
const ORDER = '10000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const ADMIN = '40000000-0000-4000-8000-000000000001';
const environment = { COD_REFUND_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') };

test('AES-256-GCM uses a fresh IV, detects tampering and fails closed without a valid key', () => {
  const first = crypt.encrypt('buyer@bank', environment);
  const second = crypt.encrypt('buyer@bank', environment);
  assert.notEqual(first, second);
  assert.equal(crypt.decrypt(first, environment), 'buyer@bank');
  const tampered = `${first.slice(0, -1)}${first.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => crypt.decrypt(tampered, environment), error => error.code === 'COD_REFUND_DECRYPTION_FAILED');
  for (const key of [undefined, '', 'short', Buffer.alloc(31).toString('base64')]) {
    assert.throws(() => crypt.encrypt('buyer@bank', { COD_REFUND_ENCRYPTION_KEY: key }),
      error => error.status === 503 && error.code === 'COD_REFUND_ENCRYPTION_UNAVAILABLE');
  }
});

test('destination validation requires matching confirmations and rejects client financial fields', () => {
  assert.deepEqual(refunds.validateDestination({ method: 'UPI', upiId: 'Buyer.Name@Bank', confirmUpiId: 'buyer.name@bank' }),
    { method: 'UPI', upiId: 'buyer.name@bank' });
  assert.deepEqual(refunds.validateDestination({ method: 'BANK', accountHolderName: 'Asha Customer', accountNumber: '001234567890',
    confirmAccountNumber: '001234567890', ifsc: 'hdfc0001234', bankName: 'Example Bank' }),
  { method: 'BANK', accountHolderName: 'Asha Customer', accountNumber: '001234567890', ifsc: 'HDFC0001234', bankName: 'Example Bank' });
  assert.throws(() => refunds.validateDestination({ method: 'UPI', upiId: 'a@bank', confirmUpiId: 'b@bank' }),
    error => error.code === 'COD_REFUND_CONFIRMATION_MISMATCH');
  assert.throws(() => refunds.validateDestination({ method: 'UPI', upiId: 'buyer@bank', confirmUpiId: 'buyer@bank', refundAmount: 1 }),
    error => error.code === 'COD_REFUND_VALIDATION');
  assert.throws(() => refunds.validateDestination({ method: 'BANK', accountHolderName: 'Asha', accountNumber: '123456',
    confirmAccountNumber: '123456', ifsc: 'INVALID00000' }), error => error.code === 'COD_REFUND_VALIDATION');
});

test('normal return summaries contain only masked COD destination data', () => {
  const summary = refunds.summary({ destination_id: 'destination-1', payment_method: 'cod', return_status: 'refund_initiated',
    return_refund_status: 'processing', method: 'BANK', masked_destination: '••••••••7890', destination_status: 'PROVIDED',
    account_number_encrypted: 'must-not-leak', transaction_reference: 'must-not-show-before-completion' });
  assert.deepEqual(summary, { required: false, provided: true, method: 'BANK', masked: '••••••••7890', status: 'PROVIDED',
    canEdit: true, transactionReference: null, completedAt: null });
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak|must-not-show/);
});

test('customer submission encrypts sensitive values before SQL and creates one pending ledger debit', async () => {
  const calls = [];
  const client = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT rr.id')) return { rows: [{ id: RETURN, order_id: ORDER, user_id: USER, return_status: 'approved',
      return_refund_status: 'manual_required', refund_amount: '725.00', payment_method: 'cod', total_amount: '799.00', destination_id: null }] };
    if (sql.startsWith('INSERT INTO cod_refund_destinations')) return { rows: [{ id: 'destination-1', return_id: RETURN, order_id: ORDER,
      user_id: USER, method: 'BANK', masked_destination: '••••••••7890', status: 'PROVIDED', submission_version: 1 }] };
    if (sql.startsWith('UPDATE return_requests')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM financial_transactions')) return { rows: [] };
    if (sql.startsWith('INSERT INTO financial_transactions')) return { rows: [{ id: 'transaction-1', status: 'PENDING' }] };
    if (sql.startsWith('INSERT INTO financial_transaction_events')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() {} };
  const database = { async connect() { return client; } };
  const result = await refunds.submit(USER, RETURN, { method: 'BANK', accountHolderName: 'Asha Customer',
    accountNumber: '001234567890', confirmAccountNumber: '001234567890', ifsc: 'HDFC0001234', bankName: 'Example Bank' },
  { database, environment, notifications: {} });
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO cod_refund_destinations'));
  const serialized = JSON.stringify(insert.params);
  for (const secret of ['Asha Customer','001234567890','HDFC0001234','Example Bank']) assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(insert.params[5], /^v1:/);
  assert.equal(result.masked, '••••••••7890');
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO financial_transactions')).length, 1);
  assert.ok(calls.some(call => call.sql.includes("type, direction") && call.params.includes('REFUND') && call.params.includes('DEBIT')));
});

test('UPI submission is encrypted, masked, and never persists the confirmation value', async () => {
  const calls = [];
  const client = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT rr.id')) return { rows: [{ id: RETURN, order_id: ORDER, user_id: USER, return_status: 'approved',
      return_refund_status: 'manual_required', refund_amount: '725.00', payment_method: 'cod', total_amount: '799.00', destination_id: null }] };
    if (sql.startsWith('INSERT INTO cod_refund_destinations')) return { rows: [{ id: 'destination-upi', method: 'UPI',
      masked_destination: 'bu***@bank', status: 'PROVIDED', submission_version: 1 }] };
    if (sql.startsWith('UPDATE return_requests') || sql.startsWith('INSERT INTO financial_transaction_events')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM financial_transactions')) return { rows: [] };
    if (sql.startsWith('INSERT INTO financial_transactions')) return { rows: [{ id: 'transaction-upi', status: 'PENDING' }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() {} };
  await refunds.submit(USER, RETURN, { method: 'UPI', upiId: 'buyer@bank', confirmUpiId: 'buyer@bank' },
    { database: { async connect() { return client; } }, environment, notifications: {} });
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO cod_refund_destinations'));
  assert.doesNotMatch(JSON.stringify(insert.params), /buyer@bank/);
  assert.match(insert.params[9], /^v1:/);
  assert.equal(insert.params[10], 'bu***@bank');
});

test('admin reveal decrypts on demand and records an access event without storing plaintext', async () => {
  const account = crypt.encrypt('001234567890', environment);
  const holder = crypt.encrypt('Asha Customer', environment);
  const ifsc = crypt.encrypt('HDFC0001234', environment);
  const calls = [];
  const client = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT d.*')) return { rows: [{ id: 'destination-1', return_id: RETURN, method: 'BANK', status: 'PROVIDED',
      payment_method: 'cod', refund_amount: '725.00', masked_destination: '••••••••7890', account_number_encrypted: account,
      account_holder_name_encrypted: holder, ifsc_encrypted: ifsc, bank_name_encrypted: null }] };
    if (sql.startsWith('INSERT INTO cod_refund_destination_access_log')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() {} };
  const detail = await refunds.reveal(ADMIN, RETURN, { database: { async connect() { return client; } }, environment });
  assert.equal(detail.accountNumber, '001234567890');
  assert.equal(detail.ifsc, 'HDFC0001234');
  const audit = calls.find(call => call.sql.startsWith('INSERT INTO cod_refund_destination_access_log'));
  assert.deepEqual(audit.params, ['destination-1', ADMIN]);
  assert.doesNotMatch(JSON.stringify(audit), /001234567890|HDFC0001234/);
});

test('retention is opt-in, bounded and redacts only expired completed destinations', async () => {
  let called = false;
  const database = { async query(sql, params) { called = true; assert.match(String(sql), /status = 'COMPLETED'/);
    assert.match(String(sql), /status = 'REDACTED'/); assert.deepEqual(params, ['90']); return { rows: [{ id: 'one' }] }; } };
  assert.equal(await refunds.redactExpired(database, {}), 0); assert.equal(called, false);
  assert.equal(await refunds.redactExpired(database, { COD_REFUND_RETENTION_DAYS: '90' }), 1);
  await assert.rejects(refunds.redactExpired(database, { COD_REFUND_RETENTION_DAYS: '0' }), error => error.status === 503);
});

test('manual COD processing can fail, retry and complete once using the same ledger debit', async () => {
  const state = { destinationStatus: 'PROVIDED', returnStatus: 'refund_initiated', refundStatus: 'processing',
    attempts: 0, reference: null, transactions: new Map(), events: new Set(), completionEmails: 0 };
  const client = { async query(statement, params = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT rr.id')) return { rows: [{ id: RETURN, order_id: ORDER, user_id: USER,
      return_status: state.returnStatus, return_refund_status: state.refundStatus, refund_amount: '725.00',
      payment_method: 'cod', total_amount: '799.00', destination_id: 'destination-1', method: 'UPI',
      masked_destination: 'bu***@bank', destination_status: state.destinationStatus,
      processing_attempt_count: state.attempts, transaction_reference: state.reference }] };
    if (sql.startsWith("UPDATE cod_refund_destinations SET status = 'PROCESSING'")) {
      state.destinationStatus = 'PROCESSING'; state.attempts += 1;
      return { rows: [{ id: 'destination-1', method: 'UPI', masked_destination: 'bu***@bank',
        status: state.destinationStatus, processing_attempt_count: state.attempts }] };
    }
    if (sql.startsWith("UPDATE cod_refund_destinations SET status = 'FAILED'")) { state.destinationStatus = 'FAILED'; return { rows: [] }; }
    if (sql.startsWith("UPDATE cod_refund_destinations SET status = 'COMPLETED'")) {
      state.destinationStatus = 'COMPLETED'; state.reference = params[1]; return { rows: [] };
    }
    if (sql.startsWith("UPDATE return_requests SET refund_status = 'processing'")) { state.refundStatus = 'processing'; return { rows: [] }; }
    if (sql.startsWith("UPDATE return_requests SET refund_status = 'failed'")) { state.refundStatus = 'failed'; return { rows: [] }; }
    if (sql.startsWith("UPDATE return_requests SET status = 'refunded'")) {
      state.returnStatus = 'refunded'; state.refundStatus = 'refunded'; return { rows: [] };
    }
    if (sql.startsWith('SELECT COALESCE(SUM(rr.refund_amount)')) return { rows: [{ refunded: '725.00' }] };
    if (sql.startsWith('UPDATE orders SET refunded_amount')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM financial_transactions')) {
      const row = state.transactions.get(params[0]); return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO financial_transactions')) {
      const row = { id: 'transaction-1', transaction_key: params[0], order_id: params[1], return_id: params[2],
        transaction_type: params[3], direction: params[4], amount: params[5], currency: 'INR', status: params[6],
        payment_method: params[7], provider: params[8], provider_reference_id: params[9] };
      state.transactions.set(params[0], row); return { rows: [row] };
    }
    if (sql.startsWith('UPDATE financial_transactions')) {
      const row = state.transactions.get(params[0]); row.status = row.status === 'SUCCESS' ? row.status : params[2];
      row.provider_reference_id ||= params[3]; return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO financial_transaction_events')) { state.events.add(params[1]); return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() {} };
  const database = { async connect() { return client; }, query: (...args) => client.query(...args) };
  const notifications = { async refundCompleted() { state.completionEmails += 1; } };

  await refunds.start(ADMIN, RETURN, { database });
  assert.equal(state.destinationStatus, 'PROCESSING');
  await refunds.fail(ADMIN, RETURN, { internalNote: 'Bank transfer rejected' }, { database });
  assert.equal(state.destinationStatus, 'FAILED'); assert.notEqual([...state.transactions.values()][0].status, 'SUCCESS');
  await refunds.start(ADMIN, RETURN, { database });
  await refunds.complete(ADMIN, RETURN, { transactionReference: 'UTR123456', internalNote: 'Verified in bank portal' },
    { database, notifications });
  await refunds.complete(ADMIN, RETURN, { transactionReference: 'UTR123456' }, { database, notifications });
  assert.equal(state.destinationStatus, 'COMPLETED'); assert.equal(state.returnStatus, 'refunded');
  assert.equal(state.reference, 'UTR123456'); assert.equal(state.transactions.size, 1);
  assert.equal([...state.transactions.values()][0].status, 'SUCCESS');
  assert.equal([...state.transactions.values()][0].provider_reference_id, 'UTR123456');
  assert.equal(state.completionEmails, 1);
  await assert.rejects(refunds.complete(ADMIN, RETURN, { transactionReference: 'DIFFERENT123' }, { database, notifications }),
    error => error.code === 'COD_REFUND_ALREADY_COMPLETED');
});

test('migration and protected routes implement one destination, reveal audit and admin-only operations', () => {
  const migration = readFileSync(path.join(__dirname, '../migrations/018_cod_refund_destinations.sql'), 'utf8');
  const adminRoutes = readFileSync(path.join(__dirname, '../routes/adminReturns.js'), 'utf8');
  const accountRoutes = readFileSync(path.join(__dirname, '../routes/account.js'), 'utf8');
  assert.match(migration, /return_id UUID NOT NULL UNIQUE/);
  assert.match(migration, /cod_refund_destination_access_log/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS created_by/);
  assert.match(adminRoutes, /router\.use\(authenticate, requireAdmin\)/);
  for (const endpoint of ['refund-destination/reveal','refund/start','refund/fail','refund/complete']) assert.match(adminRoutes, new RegExp(endpoint.replace('/', '\\/')));
  assert.match(accountRoutes, /router\.use\(authenticate\)/);
  assert.match(accountRoutes, /refund-destination/);
});
