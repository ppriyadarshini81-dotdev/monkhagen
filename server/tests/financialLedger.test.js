const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');

process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'finance-admin@example.test';
require('./helpers/rateLimitStore');

const ledger = require('../services/financialLedgerService');
const FinancialLedger = require('../models/FinancialLedger');
const exportService = require('../services/ledgerExportService');

function ledgerDatabase() {
  const transactions = new Map();
  const events = new Map();
  return {
    transactions, events,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM financial_transactions')) return { rows: transactions.has(params[0]) ? [transactions.get(params[0])] : [] };
      if (text.includes('INSERT INTO financial_transactions')) {
        const row = { id: `tx-${transactions.size + 1}`, transaction_key: params[0], order_id: params[1], return_id: params[2],
          transaction_type: params[3], direction: params[4], amount: params[5], currency: 'INR', status: params[6],
          payment_method: params[7], provider: params[8], provider_reference_id: params[9], description: params[10], occurred_at: params[11] };
        transactions.set(params[0], row); return { rows: [row] };
      }
      if (text.includes('UPDATE financial_transactions')) {
        const row = transactions.get(params[0]); Object.assign(row, { return_id: row.return_id || params[1], status: row.status === 'SUCCESS' ? 'SUCCESS' : params[2],
          provider_reference_id: row.provider_reference_id || params[3], description: params[4] });
        return { rows: [row] };
      }
      if (text.includes('INSERT INTO financial_transaction_events')) {
        if (!events.has(params[1])) events.set(params[1], { transactionId: params[0], previousStatus: params[2], newStatus: params[3], eventType: params[4], createdBy: params[6] });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }
  };
}

describe('durable financial transaction recording', () => {
  test('captured payment creates one successful credit and duplicate delivery remains one transaction', async () => {
    const db = ledgerDatabase();
    const order = { id: 'order-1', total_amount: '1299.00', paid_at: new Date('2026-10-01T08:00:00Z') };
    await ledger.payment(db, order, 'pay_123', 'event-1');
    await ledger.payment(db, order, 'pay_123', 'event-1');
    assert.equal(db.transactions.size, 1);
    const tx = [...db.transactions.values()][0];
    assert.equal(tx.direction, 'CREDIT'); assert.equal(tx.status, 'SUCCESS'); assert.equal(tx.amount, '1299.00');
    assert.equal(db.events.size, 1);
  });

  test('a refund changes the same pending debit to success without doubling it', async () => {
    const db = ledgerDatabase();
    const input = { orderId: 'order-1', returnId: 'return-1', amount: '500.00' };
    await ledger.refund(db, { ...input, status: 'PENDING', eventType: 'REFUND_INITIATED' });
    await ledger.refund(db, { ...input, refundId: 'rfnd_1', status: 'SUCCESS', eventType: 'REFUND_PROCESSED', eventId: 'event-2' });
    await ledger.refund(db, { ...input, refundId: 'rfnd_1', status: 'SUCCESS', eventType: 'REFUND_PROCESSED', eventId: 'event-2' });
    assert.equal(db.transactions.size, 1);
    const tx = [...db.transactions.values()][0];
    assert.equal(tx.direction, 'DEBIT'); assert.equal(tx.status, 'SUCCESS'); assert.equal(tx.amount, '500.00');
    assert.equal(tx.provider_reference_id, 'rfnd_1'); assert.equal(db.events.size, 2);
    await ledger.refund(db, { ...input, refundId: 'rfnd_1', status: 'PENDING', eventType: 'REFUND_ACCEPTED' });
    assert.equal(tx.status, 'SUCCESS', 'a late create response cannot downgrade a processed webhook');
  });

  test('legitimate partial refunds are distinct, full refunds work, and failed/pending remain non-success statuses', async () => {
    const db = ledgerDatabase();
    await ledger.refund(db, { orderId: 'order-1', returnId: 'return-a', refundId: 'rfnd_a', amount: '300.00', status: 'SUCCESS' });
    await ledger.refund(db, { orderId: 'order-1', returnId: 'return-b', refundId: 'rfnd_b', amount: '999.00', status: 'SUCCESS' });
    await ledger.refund(db, { orderId: 'order-2', returnId: 'return-c', amount: '250.00', status: 'FAILED' });
    await ledger.refund(db, { orderId: 'order-3', returnId: 'return-d', amount: '100.00', status: 'PENDING' });
    assert.equal(db.transactions.size, 4);
    assert.deepEqual([...db.transactions.values()].map(row => row.status), ['SUCCESS', 'SUCCESS', 'FAILED', 'PENDING']);
  });

  test('COD is an expected pending credit, never a successful receipt', async () => {
    const db = ledgerDatabase();
    await ledger.codExpected(db, { id: 'order-cod', total_amount: '1499.00', created_at: new Date() });
    const tx = [...db.transactions.values()][0];
    assert.equal(tx.transaction_type, 'COD_PAYMENT'); assert.equal(tx.direction, 'CREDIT'); assert.equal(tx.status, 'PENDING');
    await ledger.codCancelled(db, { id: 'order-cod', total_amount: '1499.00' });
    assert.equal(db.transactions.size, 1); assert.equal(tx.status, 'CANCELLED');
  });

  test('manual COD refund retries update one debit and preserve the admin audit actor', async () => {
    const db = ledgerDatabase();
    const base = { orderId: 'order-cod', returnId: 'return-cod', amount: '725.00' };
    await ledger.codRefund(db, { ...base, status: 'PENDING', eventType: 'COD_REFUND_DESTINATION_PROVIDED', eventId: '1' });
    await ledger.codRefund(db, { ...base, status: 'FAILED', eventType: 'COD_REFUND_FAILED', eventId: '1', createdBy: 'admin-1' });
    await ledger.codRefund(db, { ...base, status: 'PENDING', eventType: 'COD_REFUND_STARTED', eventId: '2', createdBy: 'admin-2' });
    await ledger.codRefund(db, { ...base, status: 'SUCCESS', reference: 'UTR987654', eventType: 'COD_REFUND_COMPLETED', eventId: 'UTR987654', createdBy: 'admin-2' });
    assert.equal(db.transactions.size, 1);
    const transaction = [...db.transactions.values()][0];
    assert.equal(transaction.direction, 'DEBIT');
    assert.equal(transaction.status, 'SUCCESS');
    assert.equal(transaction.payment_method, 'COD');
    assert.equal(transaction.provider, 'MANUAL');
    assert.equal(transaction.provider_reference_id, 'UTR987654');
    assert.equal(db.events.size, 4);
    assert.equal([...db.events.values()].at(-1).createdBy, 'admin-2');
  });
});

test('ledger filters are server-side, parameterized, composable and paginated with stable sorting', async () => {
  const calls = [];
  const database = { async query(sql, values) {
    calls.push({ sql: String(sql), values });
    if (String(sql).includes('COUNT(*)::integer')) return { rows: [{ count: 51 }] };
    return { rows: [] };
  } };
  const result = await FinancialLedger.list({ page: '2', pageSize: '25', search: 'MH-10', dateFrom: '2026-10-01', dateTo: '2026-10-31',
    type: 'refund', direction: 'debit', status: 'success', paymentMethod: 'razorpay', sortBy: 'amount', sortDirection: 'asc' }, database);
  assert.equal(result.pagination.page, 2); assert.equal(result.pagination.pages, 3);
  assert.match(calls[1].sql, /transaction_type = \$3/); assert.match(calls[1].sql, /direction = \$4/);
  assert.match(calls[1].sql, /status = \$5/); assert.match(calls[1].sql, /payment_method = \$6/);
  assert.match(calls[1].sql, /ILIKE \$7/); assert.match(calls[1].sql, /ORDER BY ft.amount ASC, ft.id ASC/);
  assert.deepEqual(calls[1].values.slice(-2), [25, 25]);
});

test('summary uses only successful movements for net and keeps pending refunds and failures separate', async () => {
  const database = { async query(sql) {
    assert.match(String(sql), /ft\.direction = 'CREDIT' AND ft\.status = 'SUCCESS'/);
    assert.match(String(sql), /ft\.direction = 'DEBIT' AND ft\.status = 'SUCCESS'/);
    assert.doesNotMatch(String(sql), /WHERE direction|WHERE status/);
    return { rows: [{ successful_credits: '2198.00', successful_debits: '500.00', pending_refunds: '250.00', failed_count: 2 }] };
  } };
  assert.deepEqual(await FinancialLedger.summary({}, database), {
    successfulCredits: 2198, successfulDebits: 500, netSuccessfulAmount: 1698,
    pendingRefunds: 250, failedTransactionCount: 2
  });
});

test('Excel export respects passed filters and produces real date/numeric money cells with summary totals', async () => {
  const originalAll = FinancialLedger.all;
  const originalSummary = FinancialLedger.summary;
  let seen;
  FinancialLedger.all = async query => { seen = query; return [{
    occurredAt: '2026-10-02T08:30:00Z', orderNumber: 'MH-1', invoiceNumber: null,
    customer: { name: 'Test Buyer', email: 'buyer@example.test', phone: '9999999999' },
    type: 'REFUND', direction: 'DEBIT', amount: 500, currency: 'INR', status: 'SUCCESS',
    paymentMethod: 'RAZORPAY', returnNumber: 'R-1', provider: 'RAZORPAY', providerReferenceId: 'rfnd_1', description: 'Processed refund'
  }]; };
  FinancialLedger.summary = async () => ({ successfulCredits: 1299, successfulDebits: 500, netSuccessfulAmount: 799, pendingRefunds: 0, failedTransactionCount: 0 });
  try {
    const { book } = await exportService.workbook({ status: 'SUCCESS', dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    const buffer = await book.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(buffer);
    const sheet = reopened.getWorksheet('Ledger');
    assert.equal(seen.status, 'SUCCESS'); assert.ok(sheet.autoFilter);
    assert.ok(sheet.getCell('A2').value instanceof Date); assert.equal(sheet.getCell('I2').value, null); assert.equal(sheet.getCell('J2').value, 500);
    assert.equal(reopened.getWorksheet('Summary').getCell('B6').value, 799);
  } finally { FinancialLedger.all = originalAll; FinancialLedger.summary = originalSummary; }
});

test('migration is additive, duplicate-safe and backfills only authoritative financial evidence', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '015_financial_ledger.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS financial_transactions/);
  assert.match(sql, /transaction_key VARCHAR\(255\) NOT NULL UNIQUE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS financial_transaction_events/);
  assert.match(sql, /razorpay_payment_id IS NOT NULL/); assert.match(sql, /paid_at IS NOT NULL/);
  assert.match(sql, /Expected COD collection; remittance not yet confirmed/);
  assert.match(sql, /payment_refunds/); assert.match(sql, /ON CONFLICT DO NOTHING/g);
});

test('follow-up migration safely repairs missing financial event actor attribution', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'migrations', '019_financial_event_actor.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE financial_transaction_events/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users\(id\) ON DELETE SET NULL/);
});

describe('ledger route authorization', () => {
  const User = require('../models/User');
  const originalFind = User.findById;
  const originalList = FinancialLedger.list;
  const originalSummary = FinancialLedger.summary;
  const { signToken } = require('../middleware/auth');
  let server; let base;
  function account(role) { return { id: `${role}-id`, role, name: role, isActive: true,
    email: role === 'customer' ? 'customer@example.test' : process.env.ADMIN_GOOGLE_EMAIL,
    firebaseUid: role === 'customer' ? 'customer-uid' : `${role}-google-uid`, sessionVersion: 0 }; }
  before(async () => {
    User.findById = async id => id === 'customer-id' ? account('customer') : id === 'super_admin-id' ? account('super_admin') : account('admin');
    FinancialLedger.list = async () => ({ transactions: [], pagination: { page: 1, pageSize: 25, total: 0, pages: 1 } });
    FinancialLedger.summary = async () => ({ successfulCredits: 0, successfulDebits: 0, netSuccessfulAmount: 0, pendingRefunds: 0, failedTransactionCount: 0 });
    const app = express(); app.use('/api/admin/ledger', require('../routes/adminLedger'));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: 'failed' }));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { User.findById = originalFind; FinancialLedger.list = originalList; FinancialLedger.summary = originalSummary;
    await new Promise(resolve => server.close(resolve)); });
  test('anonymous and customer access are rejected while admin and superadmin are allowed', async () => {
    assert.equal((await fetch(`${base}/api/admin/ledger`)).status, 401);
    const customer = account('customer');
    assert.equal((await fetch(`${base}/api/admin/ledger`, { headers: { Authorization: `Bearer ${signToken(customer, { provider: 'google.com' })}` } })).status, 403);
    for (const role of ['admin', 'super_admin']) {
      const user = account(role);
      const response = await fetch(`${base}/api/admin/ledger`, { headers: { Authorization: `Bearer ${signToken(user, { provider: 'google.com' })}` } });
      assert.equal(response.status, 200, role);
    }
  });
});
