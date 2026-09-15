const { pool } = require('../config/db');
const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const addressValidationError = require('../services/addressValidation');

// ── Profile ───────────────────────────────────────────────────────────────────

exports.getProfile = asyncHandler(async (req, res) => {
  res.json(req.user.toJSON());
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, dateOfBirth } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters.' });
  }
  if (phone && !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ message: 'Phone must be a 10-digit number.' });
  }
  const updated = await User.updateProfile(req.user.id, {
    name: name.trim(),
    phone: phone || null,
    dateOfBirth: dateOfBirth || null
  });
  res.json(updated.toJSON());
});

// ── Addresses ─────────────────────────────────────────────────────────────────

function fmtAddr(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 || null,
    landmark: row.landmark || null,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    addressType: row.address_type,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

exports.getAddresses = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
    [req.user.id]
  );
  res.json(rows.map(fmtAddr));
});

exports.getDefaultAddress = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM customer_addresses WHERE user_id = $1 AND is_default = TRUE LIMIT 1',
    [req.user.id]
  );
  res.json(rows[0] ? fmtAddr(rows[0]) : null);
});

exports.addAddress = asyncHandler(async (req, res) => {
  const validationError = addressValidationError(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const { fullName, phone, addressLine1, addressLine2, landmark, city, state, postalCode, country = 'India', addressType = 'Home' } = req.body;
  if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ message: 'fullName, phone, addressLine1, city, state and postalCode are required.' });
  }
  const { rows: existing } = await pool.query(
    'SELECT id FROM customer_addresses WHERE user_id = $1', [req.user.id]
  );
  const makeDefault = existing.length === 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO customer_addresses (user_id, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country, address_type, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, fullName, phone, addressLine1, addressLine2 || null, landmark || null, city, state, postalCode, country, addressType, makeDefault]
    );
    await client.query('COMMIT');
    res.status(201).json(fmtAddr(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

exports.updateAddress = asyncHandler(async (req, res) => {
  const validationError = addressValidationError(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const { id } = req.params;
  const { rows: owned } = await pool.query(
    'SELECT id FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]
  );
  if (!owned[0]) return res.status(404).json({ message: 'Address not found.' });

  const { fullName, phone, addressLine1, addressLine2, landmark, city, state, postalCode, country = 'India', addressType = 'Home' } = req.body;
  const { rows } = await pool.query(
    `UPDATE customer_addresses
     SET full_name=$1, phone=$2, address_line1=$3, address_line2=$4, landmark=$5,
         city=$6, state=$7, postal_code=$8, country=$9, address_type=$10, updated_at=NOW()
     WHERE id=$11 AND user_id=$12 RETURNING *`,
    [fullName, phone, addressLine1, addressLine2 || null, landmark || null, city, state, postalCode, country, addressType, id, req.user.id]
  );
  res.json(fmtAddr(rows[0]));
});

exports.deleteAddress = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM customer_addresses WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Address not found.' });

  // If deleted address was default, promote the oldest remaining address
  if (rows[0].is_default) {
    await pool.query(
      `UPDATE customer_addresses SET is_default = TRUE, updated_at = NOW()
       WHERE id = (SELECT id FROM customer_addresses WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)`,
      [req.user.id]
    );
  }
  res.json({ message: 'Address deleted.' });
});

exports.setDefaultAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows: owned } = await pool.query(
    'SELECT id FROM customer_addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]
  );
  if (!owned[0]) return res.status(404).json({ message: 'Address not found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE customer_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );
    const { rows } = await client.query(
      'UPDATE customer_addresses SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    await client.query('COMMIT');
    res.json(fmtAddr(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

function fmtOrderItem(i) {
  return {
    id: i.id,
    productId: i.product_id,
    variantId: i.variant_id,
    productName: i.product_name,
    sku: i.sku || null,
    size: i.size || null,
    color: i.color || null,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    totalPrice: Number(i.total_price)
  };
}

function fmtOrderAddr(a) {
  if (!a) return null;
  return {
    fullName: a.full_name,
    phone: a.phone,
    addressLine1: a.address_line1,
    addressLine2: a.address_line2 || null,
    city: a.city,
    state: a.state,
    postalCode: a.postal_code,
    country: a.country
  };
}

function fmtOrder(o, items, addr) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.order_status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discount_amount),
    shippingAmount: Number(o.shipping_amount),
    totalAmount: Number(o.total_amount),
    items: (items || []).map(fmtOrderItem),
    address: fmtOrderAddr(addr),
    awbNumber: o.awb_number || null,
    courierName: o.courier_name || null,
    trackingUrl: o.tracking_url || null,
    shippedAt: o.shipped_at || null,
    deliveredAt: o.delivered_at || null,
    createdAt: o.created_at,
    updatedAt: o.updated_at
  };
}

async function enrichOrder(o) {
  const [itemsRes, addrRes] = await Promise.all([
    pool.query('SELECT * FROM order_items WHERE order_id = $1', [o.id]),
    pool.query('SELECT * FROM order_addresses WHERE order_id = $1', [o.id])
  ]);
  return fmtOrder(o, itemsRes.rows, addrRes.rows[0]);
}

exports.getOrders = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  const orders = await Promise.all(rows.map(enrichOrder));
  res.json(orders);
});

exports.getOrder = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
    [req.params.orderId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Order not found.' });
  res.json(await enrichOrder(rows[0]));
});

exports.getTracking = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT order_status, awb_number, courier_name, tracking_url, shipped_at, delivered_at, updated_at
     FROM orders WHERE id = $1 AND user_id = $2`,
    [req.params.orderId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Order not found.' });
  const r = rows[0];
  res.json({
    status: r.order_status,
    awbNumber: r.awb_number || null,
    courierName: r.courier_name || null,
    trackingUrl: r.tracking_url || null,
    shippedAt: r.shipped_at || null,
    deliveredAt: r.delivered_at || null,
    updatedAt: r.updated_at
  });
});

// ── Returns ───────────────────────────────────────────────────────────────────

const RETURN_WINDOW_DAYS = 7;

function fmtReturn(rr) {
  return {
    id: rr.id,
    orderId: rr.order_id,
    returnNumber: rr.return_number,
    reason: rr.reason,
    comments: rr.comments || null,
    status: rr.status,
    refundAmount: Number(rr.refund_amount),
    refundStatus: rr.refund_status,
    items: rr.items || [],
    requestedAt: rr.requested_at,
    approvedAt: rr.approved_at || null,
    completedAt: rr.completed_at || null,
    createdAt: rr.created_at
  };
}

exports.getReturns = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT rr.*,
            COALESCE(json_agg(json_build_object(
              'id', ri.id, 'orderItemId', ri.order_item_id,
              'quantity', ri.quantity, 'reason', ri.reason
            )) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
     FROM return_requests rr
     LEFT JOIN return_items ri ON ri.return_request_id = rr.id
     WHERE rr.user_id = $1
     GROUP BY rr.id
     ORDER BY rr.created_at DESC`,
    [req.user.id]
  );
  res.json(rows.map(fmtReturn));
});

exports.createReturn = asyncHandler(async (req, res) => {
  const { orderId, reason, comments, items } = req.body;
  if (!orderId || !reason || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'orderId, reason and items are required.' });
  }

  const { rows: oRows } = await pool.query(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, req.user.id]
  );
  if (!oRows[0]) return res.status(404).json({ message: 'Order not found.' });

  const order = oRows[0];
  if (order.order_status !== 'delivered') {
    return res.status(400).json({ message: 'Only delivered orders are eligible for return.' });
  }

  const deliveredAt = order.delivered_at || order.updated_at;
  const daysSince = (Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > RETURN_WINDOW_DAYS) {
    return res.status(400).json({ message: `Return window of ${RETURN_WINDOW_DAYS} days has expired.` });
  }

  const { rows: existing } = await pool.query(
    `SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected','cancelled')`,
    [orderId]
  );
  if (existing.length) return res.status(409).json({ message: 'A return request for this order already exists.' });

  const returnNumber = `RET-${Date.now().toString(36).toUpperCase()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: rrRows } = await client.query(
      `INSERT INTO return_requests (order_id, user_id, return_number, reason, comments)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [orderId, req.user.id, returnNumber, reason, comments || null]
    );
    const rr = rrRows[0];
    for (const item of items) {
      await client.query(
        `INSERT INTO return_items (return_request_id, order_item_id, quantity, reason)
         VALUES ($1,$2,$3,$4)`,
        [rr.id, item.orderItemId, item.quantity || 1, item.reason || null]
      );
    }
    await client.query(
      `UPDATE orders SET order_status = 'return_requested', updated_at = NOW() WHERE id = $1`, [orderId]
    );
    await client.query('COMMIT');
    res.status(201).json(fmtReturn({ ...rr, items: [] }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Credits ───────────────────────────────────────────────────────────────────

exports.getCredits = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT balance FROM credit_accounts WHERE user_id = $1', [req.user.id]
  );
  res.json({ balance: rows[0] ? Number(rows[0].balance) : 0 });
});

exports.getCreditTransactions = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows.map(r => ({
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    reason: r.reason,
    referenceType: r.reference_type || null,
    referenceId: r.reference_id || null,
    expiresAt: r.expires_at || null,
    createdAt: r.created_at
  })));
});
