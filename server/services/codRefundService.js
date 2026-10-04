const { pool } = require('../config/db');
const crypt = require('./codRefundCrypto');
const ledger = require('./financialLedgerService');
const emails = require('./transactionalEmailService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPI = /^[A-Za-z0-9][A-Za-z0-9._+-]{1,254}@[A-Za-z0-9][A-Za-z0-9.-]{1,63}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{6,20}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ./_:-]{2,99}$/;

function fault(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function returnId(value) { if (!UUID.test(value || '')) throw fault(400, 'RETURN_VALIDATION', 'Select a valid return.'); return value; }
function clean(value, field, min, max, required = true) {
  if (!required && (value == null || String(value).trim() === '')) return null;
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) throw fault(400, 'COD_REFUND_VALIDATION', `Please enter a valid ${field}.`);
  return value.trim();
}

function validateDestination(body = {}) {
  const method = String(body.method || '').toUpperCase();
  const common = new Set(['method']);
  if (method === 'UPI') {
    for (const key of ['upiId','confirmUpiId']) common.add(key);
    if (Object.keys(body).some(key => !common.has(key))) throw fault(400, 'COD_REFUND_VALIDATION', 'Invalid refund detail fields.');
    const upiId = clean(body.upiId, 'UPI ID', 5, 320).toLowerCase();
    const confirm = clean(body.confirmUpiId, 'confirmation UPI ID', 5, 320).toLowerCase();
    if (upiId !== confirm) throw fault(400, 'COD_REFUND_CONFIRMATION_MISMATCH', 'UPI IDs do not match.');
    if (!UPI.test(upiId)) throw fault(400, 'COD_REFUND_VALIDATION', 'Please enter a valid UPI ID.');
    return { method, upiId };
  }
  if (method === 'BANK') {
    for (const key of ['accountHolderName','accountNumber','confirmAccountNumber','ifsc','bankName']) common.add(key);
    if (Object.keys(body).some(key => !common.has(key))) throw fault(400, 'COD_REFUND_VALIDATION', 'Invalid refund detail fields.');
    const accountHolderName = clean(body.accountHolderName, 'account holder name', 2, 100);
    const accountNumber = clean(body.accountNumber, 'account number', 6, 20);
    const confirm = clean(body.confirmAccountNumber, 'confirmation account number', 6, 20);
    if (accountNumber !== confirm) throw fault(400, 'COD_REFUND_CONFIRMATION_MISMATCH', 'Account numbers do not match.');
    if (!ACCOUNT.test(accountNumber)) throw fault(400, 'COD_REFUND_VALIDATION', 'Please enter a valid account number.');
    const ifsc = clean(body.ifsc, 'IFSC code', 11, 11).toUpperCase();
    if (!IFSC.test(ifsc)) throw fault(400, 'COD_REFUND_VALIDATION', 'Please enter a valid IFSC code.');
    const bankName = clean(body.bankName, 'bank name', 2, 100, false);
    return { method, accountHolderName, accountNumber, ifsc, bankName };
  }
  throw fault(400, 'COD_REFUND_VALIDATION', 'Choose UPI or Bank Account.');
}

function summary(row) {
  const provided = Boolean(row?.destination_id || row?.id);
  const paymentMethod = row?.payment_method;
  const returnStatus = row?.return_status || row?.status;
  const refundStatus = row?.return_refund_status || row?.refund_status;
  return {
    required: paymentMethod === 'cod' && returnStatus === 'approved' && refundStatus === 'manual_required' && !provided,
    provided,
    method: provided ? row.method : null,
    masked: provided ? row.masked_destination : null,
    status: provided ? row.destination_status || row.status : null,
    canEdit: provided && (row.destination_status || row.status) === 'PROVIDED',
    transactionReference: provided && ['COMPLETED','REDACTED'].includes(row.destination_status || row.status)
      ? row.transaction_reference || null : null,
    completedAt: provided ? row.destination_completed_at || row.completed_at || null : null
  };
}

async function loadReturn(database, id, userId = null, lock = false) {
  const params = [returnId(id)];
  const owner = userId ? `AND rr.user_id = $${params.push(userId)}` : '';
  const result = await database.query(`SELECT rr.id, rr.order_id, rr.user_id, rr.status AS return_status,
      rr.refund_status AS return_refund_status, rr.refund_amount, o.payment_method, o.total_amount,
      d.id AS destination_id, d.method, d.masked_destination, d.status AS destination_status,
      d.submission_version, d.processing_attempt_count, d.transaction_reference,
      d.completed_at AS destination_completed_at
    FROM return_requests rr JOIN orders o ON o.id = rr.order_id
    LEFT JOIN cod_refund_destinations d ON d.return_id = rr.id
    WHERE rr.id = $1 ${owner} ${lock ? 'FOR UPDATE OF rr' : ''}`, params);
  return result.rows[0] || null;
}

function assertCodEligible(row) {
  if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  if (row.payment_method !== 'cod') throw fault(409, 'COD_REFUND_NOT_APPLICABLE', 'Prepaid refunds are returned through the original payment method.');
  if (row.return_status === 'refunded' || row.return_refund_status === 'refunded') throw fault(409, 'COD_REFUND_COMPLETED', 'This refund has already been completed.');
}

async function getCustomer(userId, id, database = pool) {
  const row = await loadReturn(database, id, userId);
  if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  return summary(row);
}

async function submit(userId, id, body, { database = pool, environment = process.env, notifications = emails } = {}) {
  const input = validateDestination(body);
  const encrypted = input.method === 'UPI' ? {
    upi: crypt.encrypt(input.upiId, environment), masked: crypt.maskUpi(input.upiId)
  } : {
    holder: crypt.encrypt(input.accountHolderName, environment), account: crypt.encrypt(input.accountNumber, environment),
    ifsc: crypt.encrypt(input.ifsc, environment), bank: input.bankName ? crypt.encrypt(input.bankName, environment) : null,
    last4: input.accountNumber.slice(-4), masked: crypt.maskAccount(input.accountNumber)
  };
  const client = await database.connect();
  let saved;
  try {
    await client.query('BEGIN');
    const row = await loadReturn(client, id, userId, true);
    assertCodEligible(row);
    if (row.destination_id && row.destination_status !== 'PROVIDED') throw fault(409, 'COD_REFUND_DESTINATION_LOCKED', 'Refund details can no longer be changed.');
    if (!row.destination_id && (row.return_status !== 'approved' || row.return_refund_status !== 'manual_required')) {
      throw fault(409, 'COD_REFUND_NOT_ELIGIBLE', 'This return is not currently eligible for refund details.');
    }
    const values = [row.id, row.order_id, row.user_id, input.method,
      encrypted.holder || null, encrypted.account || null, encrypted.last4 || null,
      encrypted.ifsc || null, encrypted.bank || null, encrypted.upi || null, encrypted.masked, crypt.KEY_VERSION];
    saved = (await client.query(`INSERT INTO cod_refund_destinations
      (return_id, order_id, user_id, method, account_holder_name_encrypted, account_number_encrypted,
       account_last4, ifsc_encrypted, bank_name_encrypted, upi_id_encrypted, masked_destination, encryption_key_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (return_id) DO UPDATE SET method = EXCLUDED.method,
        account_holder_name_encrypted = EXCLUDED.account_holder_name_encrypted,
        account_number_encrypted = EXCLUDED.account_number_encrypted, account_last4 = EXCLUDED.account_last4,
        ifsc_encrypted = EXCLUDED.ifsc_encrypted, bank_name_encrypted = EXCLUDED.bank_name_encrypted,
        upi_id_encrypted = EXCLUDED.upi_id_encrypted, masked_destination = EXCLUDED.masked_destination,
        encryption_key_version = EXCLUDED.encryption_key_version, submission_version = cod_refund_destinations.submission_version + 1,
        submitted_at = NOW(), updated_at = NOW()
      WHERE cod_refund_destinations.status = 'PROVIDED' RETURNING *`, values)).rows[0];
    if (!saved) throw fault(409, 'COD_REFUND_DESTINATION_LOCKED', 'Refund details can no longer be changed.');
    await client.query(`UPDATE return_requests SET status = 'refund_initiated', refund_status = 'processing',
      refund_initiated_at = COALESCE(refund_initiated_at, NOW()), updated_at = NOW() WHERE id = $1`, [row.id]);
    await ledger.codRefund(client, { orderId: row.order_id, returnId: row.id, amount: row.refund_amount,
      status: 'PENDING', eventType: 'COD_REFUND_DESTINATION_PROVIDED', eventId: String(saved.submission_version),
      description: `Manual COD refund pending via ${input.method}` });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  if (typeof notifications.codRefundPending === 'function') {
    await notifications.codRefundPending(id).catch(() => {});
  }
  return summary({ ...saved, destination_id: saved.id, destination_status: saved.status,
    payment_method: 'cod', return_status: 'refund_initiated', return_refund_status: 'processing' });
}

async function reveal(adminId, id, { database = pool, environment = process.env } = {}) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT d.*, rr.refund_amount, rr.status AS return_status, o.payment_method
      FROM cod_refund_destinations d JOIN return_requests rr ON rr.id = d.return_id
      JOIN orders o ON o.id = d.order_id WHERE d.return_id = $1 FOR UPDATE OF d`, [returnId(id)])).rows[0];
    if (!row) throw fault(404, 'COD_REFUND_DESTINATION_NOT_FOUND', 'Refund destination has not been provided.');
    if (row.payment_method !== 'cod') throw fault(409, 'COD_REFUND_NOT_APPLICABLE', 'This is not a COD refund.');
    if (row.status === 'REDACTED') throw fault(410, 'COD_REFUND_DESTINATION_REDACTED', 'Sensitive refund details are no longer retained.');
    const detail = row.method === 'UPI'
      ? { method: 'UPI', upiId: crypt.decrypt(row.upi_id_encrypted, environment) }
      : { method: 'BANK', accountHolderName: crypt.decrypt(row.account_holder_name_encrypted, environment),
        accountNumber: crypt.decrypt(row.account_number_encrypted, environment), ifsc: crypt.decrypt(row.ifsc_encrypted, environment),
        bankName: row.bank_name_encrypted ? crypt.decrypt(row.bank_name_encrypted, environment) : null };
    await client.query(`INSERT INTO cod_refund_destination_access_log
      (refund_destination_id, admin_user_id, action) VALUES ($1,$2,'VIEWED_REFUND_DESTINATION')`, [row.id, adminId]);
    await client.query('COMMIT');
    return { ...detail, refundAmount: Number(row.refund_amount), status: row.status, masked: row.masked_destination };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function start(adminId, id, { database = pool } = {}) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const row = await loadReturn(client, id, null, true); assertCodEligible(row);
    if (!row.destination_id) throw fault(409, 'COD_REFUND_DESTINATION_REQUIRED', 'The customer has not provided refund details.');
    if (!['PROVIDED','FAILED'].includes(row.destination_status)) throw fault(409, 'COD_REFUND_TRANSITION_INVALID', 'This refund cannot be started in its current state.');
    const updated = (await client.query(`UPDATE cod_refund_destinations SET status = 'PROCESSING',
      processing_attempt_count = processing_attempt_count + 1, processing_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('PROVIDED','FAILED') RETURNING *`, [row.destination_id])).rows[0];
    await client.query("UPDATE return_requests SET refund_status = 'processing', last_error_code = NULL, updated_at = NOW() WHERE id = $1", [row.id]);
    await ledger.codRefund(client, { orderId: row.order_id, returnId: row.id, amount: row.refund_amount,
      status: 'PENDING', eventType: 'COD_REFUND_STARTED', eventId: String(updated.processing_attempt_count), createdBy: adminId });
    await client.query('COMMIT');
    return summary({ ...updated, destination_id: updated.id, destination_status: updated.status,
      payment_method: 'cod', return_status: row.return_status, return_refund_status: 'processing' });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

function completionInput(body = {}) {
  if (Object.keys(body).some(key => !['transactionReference','internalNote'].includes(key))) throw fault(400, 'COD_REFUND_VALIDATION', 'Invalid refund completion fields.');
  const transactionReference = clean(body.transactionReference, 'transaction reference / UTR', 3, 100).toUpperCase();
  if (!REFERENCE.test(transactionReference)) throw fault(400, 'COD_REFUND_VALIDATION', 'Please enter a valid transaction reference / UTR.');
  return { transactionReference, internalNote: clean(body.internalNote, 'internal note', 0, 500, false) };
}

async function complete(adminId, id, body, { database = pool, notifications = emails } = {}) {
  const input = completionInput(body); const client = await database.connect(); let row;
  try {
    await client.query('BEGIN');
    row = await loadReturn(client, id, null, true);
    if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    if (row.destination_status === 'COMPLETED' || row.destination_status === 'REDACTED') {
      if (row.transaction_reference !== input.transactionReference) throw fault(409, 'COD_REFUND_ALREADY_COMPLETED', 'This refund was completed with a different reference.');
      await client.query('COMMIT'); return summary(row);
    }
    assertCodEligible(row);
    if (row.destination_status !== 'PROCESSING') throw fault(409, 'COD_REFUND_TRANSITION_INVALID', 'Start processing this refund before completing it.');
    await client.query(`UPDATE cod_refund_destinations SET status = 'COMPLETED', transaction_reference = $2,
      internal_note = $3, completed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'PROCESSING'`,
    [row.destination_id, input.transactionReference, input.internalNote]);
    await client.query(`UPDATE return_requests SET status = 'refunded', refund_status = 'refunded',
      refunded_at = COALESCE(refunded_at, NOW()), completed_at = COALESCE(completed_at, NOW()),
      last_error_code = NULL, updated_at = NOW() WHERE id = $1`, [row.id]);
    const totals = await client.query(`SELECT COALESCE(SUM(rr.refund_amount),0) AS refunded
      FROM return_requests rr JOIN cod_refund_destinations d ON d.return_id = rr.id
      WHERE rr.order_id = $1 AND d.status IN ('COMPLETED','REDACTED')`, [row.order_id]);
    const refunded = Number(totals.rows[0].refunded);
    if (refunded > Number(row.total_amount)) throw fault(409, 'COD_REFUND_AMOUNT_INVALID', 'Completed refunds exceed the order total.');
    await client.query(`UPDATE orders SET refunded_amount = $1,
      payment_status = $2, fulfillment_hold_reason = 'ORDER_REFUND_REVIEW_REQUIRED', updated_at = NOW() WHERE id = $3`,
    [refunded.toFixed(2), refunded === Number(row.total_amount) ? 'refunded' : 'partially_refunded', row.order_id]);
    await ledger.codRefund(client, { orderId: row.order_id, returnId: row.id, amount: row.refund_amount,
      status: 'SUCCESS', reference: input.transactionReference, eventType: 'COD_REFUND_COMPLETED',
      eventId: input.transactionReference, occurredAt: new Date(), createdBy: adminId });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  await notifications.refundCompleted(id, input.transactionReference).catch(() => {});
  return getAdminSummary(id, database);
}

async function fail(adminId, id, body = {}, { database = pool } = {}) {
  if (Object.keys(body).some(key => key !== 'internalNote')) {
    throw fault(400, 'COD_REFUND_VALIDATION', 'Invalid refund failure fields.');
  }
  const note = clean(body.internalNote, 'internal note', 2, 500); const client = await database.connect();
  try {
    await client.query('BEGIN');
    const row = await loadReturn(client, id, null, true); assertCodEligible(row);
    if (row.destination_status !== 'PROCESSING') throw fault(409, 'COD_REFUND_TRANSITION_INVALID', 'Only a processing refund can be marked failed.');
    await client.query("UPDATE cod_refund_destinations SET status = 'FAILED', internal_note = $2, updated_at = NOW() WHERE id = $1", [row.destination_id, note]);
    await client.query("UPDATE return_requests SET refund_status = 'failed', last_error_code = 'COD_REFUND_TRANSFER_FAILED', updated_at = NOW() WHERE id = $1", [row.id]);
    await ledger.codRefund(client, { orderId: row.order_id, returnId: row.id, amount: row.refund_amount,
      status: 'FAILED', eventType: 'COD_REFUND_FAILED', eventId: String(row.processing_attempt_count),
      description: 'Manual COD refund transfer failed', createdBy: adminId });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  return getAdminSummary(id, database);
}

async function getAdminSummary(id, database = pool) {
  const row = await loadReturn(database, id);
  if (!row) throw fault(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  return summary(row);
}

async function redactExpired(database = pool, environment = process.env) {
  const raw = environment.COD_REFUND_RETENTION_DAYS;
  if (raw == null || raw === '') return 0;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > 3650) throw configurationError();
  const result = await database.query(`UPDATE cod_refund_destinations SET
    account_holder_name_encrypted = NULL, account_number_encrypted = NULL, ifsc_encrypted = NULL,
    bank_name_encrypted = NULL, upi_id_encrypted = NULL, status = 'REDACTED', redacted_at = NOW(), updated_at = NOW()
    WHERE id IN (SELECT id FROM cod_refund_destinations WHERE status = 'COMPLETED'
      AND completed_at < NOW() - ($1::text || ' days')::interval ORDER BY completed_at LIMIT 100)
    RETURNING id`, [raw]);
  return result.rows.length;
}

function configurationError() { return fault(503, 'COD_REFUND_RETENTION_INVALID', 'COD refund retention is not configured safely.'); }

module.exports = { validateDestination, summary, getCustomer, submit, reveal, start, complete, fail,
  getAdminSummary, redactExpired, loadReturn };
