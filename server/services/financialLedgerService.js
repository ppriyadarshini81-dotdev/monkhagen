const STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']);

function money(value) {
  const normalized = Number(value).toFixed(2);
  if (!/^\d+\.\d{2}$/.test(normalized) || Number(normalized) <= 0) {
    throw Object.assign(new Error('Ledger amount must be a positive monetary value.'), { status: 409 });
  }
  return normalized;
}

async function record(database, transaction, event) {
  if (!STATUSES.has(transaction.status)) throw new Error('Unsupported ledger status.');
  const existing = await database.query('SELECT * FROM financial_transactions WHERE transaction_key = $1 FOR UPDATE', [transaction.key]);
  const previous = existing.rows[0] || null;
  let row;
  if (!previous) {
    row = (await database.query(
      `INSERT INTO financial_transactions
       (transaction_key, order_id, return_id, transaction_type, direction, amount, currency, status,
        payment_method, provider, provider_reference_id, description, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,$10,$11,$12) RETURNING *`,
      [transaction.key, transaction.orderId, transaction.returnId || null, transaction.type,
        transaction.direction, money(transaction.amount), transaction.status, transaction.paymentMethod,
        transaction.provider, transaction.providerReferenceId || null, transaction.description,
        transaction.occurredAt || new Date()]
    )).rows[0] || {
      id: transaction.key, order_id: transaction.orderId, return_id: transaction.returnId || null,
      transaction_type: transaction.type, direction: transaction.direction, amount: money(transaction.amount),
      currency: 'INR', status: transaction.status
    };
  } else {
    if (previous.order_id !== transaction.orderId || previous.transaction_type !== transaction.type ||
        previous.direction !== transaction.direction || money(previous.amount) !== money(transaction.amount) ||
        previous.currency !== 'INR' || (previous.return_id && previous.return_id !== transaction.returnId) ||
        (previous.payment_method && previous.payment_method !== transaction.paymentMethod) ||
        (previous.provider && previous.provider !== transaction.provider) ||
        (previous.provider_reference_id && transaction.providerReferenceId && previous.provider_reference_id !== transaction.providerReferenceId)) {
      throw Object.assign(new Error('Ledger idempotency key is linked to different financial details.'), { status: 409 });
    }
    row = (await database.query(
      `UPDATE financial_transactions SET return_id = COALESCE(return_id, $2),
         status = CASE WHEN status = 'SUCCESS' THEN status ELSE $3 END,
         provider_reference_id = COALESCE(provider_reference_id, $4), description = $5,
         occurred_at = COALESCE($6, occurred_at), updated_at = NOW()
       WHERE transaction_key = $1 RETURNING *`,
      [transaction.key, transaction.returnId || null, transaction.status,
        transaction.providerReferenceId || null, transaction.description, transaction.occurredAt || null]
    )).rows[0];
  }
  await database.query(
    `INSERT INTO financial_transaction_events
       (transaction_id, event_key, previous_status, new_status, event_type, provider_event_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_key) DO NOTHING`,
    [row.id, event.key.slice(0, 320), previous?.status || null, row.status,
      event.type, event.providerEventId || null, event.createdBy || null]
  );
  return row;
}

function payment(database, order, paymentId, providerEventId = null) {
  return record(database, {
    key: `PAYMENT:${order.id}`, orderId: order.id, type: 'PAYMENT', direction: 'CREDIT',
    amount: order.total_amount, status: 'SUCCESS', paymentMethod: 'RAZORPAY', provider: 'RAZORPAY',
    providerReferenceId: paymentId, description: 'Captured Razorpay order payment',
    occurredAt: order.paid_at || new Date()
  }, { key: `PAYMENT:${paymentId}:SUCCESS`, type: 'PAYMENT_CAPTURED', providerEventId });
}

function codExpected(database, order) {
  return record(database, {
    key: `COD_PAYMENT:${order.id}`, orderId: order.id, type: 'COD_PAYMENT', direction: 'CREDIT',
    amount: order.total_amount, status: 'PENDING', paymentMethod: 'COD', provider: 'COD',
    description: 'Expected COD collection; remittance not yet confirmed', occurredAt: order.created_at || new Date()
  }, { key: `COD_PAYMENT:${order.id}:EXPECTED`, type: 'COD_EXPECTED' });
}

function codCancelled(database, order) {
  return record(database, {
    key: `COD_PAYMENT:${order.id}`, orderId: order.id, type: 'COD_PAYMENT', direction: 'CREDIT',
    amount: order.total_amount, status: 'CANCELLED', paymentMethod: 'COD', provider: 'COD',
    description: 'Expected COD collection cancelled with order', occurredAt: null
  }, { key: `COD_PAYMENT:${order.id}:CANCELLED`, type: 'COD_CANCELLED' });
}

function refund(database, { orderId, returnId = null, refundId = null, amount, status, eventId = null,
  eventType = 'REFUND_STATUS_CHANGED', occurredAt = null, description = null,
  paymentMethod = 'RAZORPAY', provider = 'RAZORPAY', createdBy = null }) {
  const key = returnId ? `REFUND:RETURN:${returnId}` : `REFUND:RAZORPAY:${refundId}`;
  return record(database, {
    key, orderId, returnId, type: 'REFUND', direction: 'DEBIT', amount, status,
    paymentMethod, provider, providerReferenceId: refundId,
    description: description || (status === 'SUCCESS' ? 'Processed Razorpay refund' : 'Razorpay refund awaiting confirmation'),
    occurredAt
  }, {
    key: `${key}:${eventType}:${eventId || refundId || returnId || status}`,
    type: eventType, providerEventId: eventId, createdBy
  });
}

function codRefund(database, { orderId, returnId, amount, status, reference = null,
  eventType, eventId = null, occurredAt = null, description = null, createdBy = null }) {
  return refund(database, { orderId, returnId, refundId: reference, amount, status, eventId,
    eventType, occurredAt, description: description || (status === 'SUCCESS'
      ? 'Completed manual COD refund' : 'Manual COD refund awaiting transfer'),
    paymentMethod: 'COD', provider: 'MANUAL', createdBy });
}

module.exports = { record, payment, codExpected, codCancelled, refund, codRefund };
