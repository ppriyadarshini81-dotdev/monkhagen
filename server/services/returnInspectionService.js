const { pool } = require('../config/db');
const inventory = require('./inventoryService');

function fault(code, message) { return Object.assign(new Error(message), { status: 409, code }); }

async function submit(returnId, input, actorUserId, dependencies = {}) {
  const returns = require('./returnService');
  const database = dependencies.database || pool;
  const decisions = returns.inspectionDecisions(input);
  const client = await database.connect();
  let request, rejected = false;
  try {
    await client.query('BEGIN');
    request = (await client.query(`SELECT rr.*, o.payment_method FROM return_requests rr
      JOIN orders o ON o.id=rr.order_id WHERE rr.id=$1 FOR UPDATE OF rr`, [returnId])).rows[0];
    if (!request) throw fault('RETURN_NOT_FOUND', 'Return request not found.');
    if (!['return', 'defect'].includes(request.request_type)) throw fault('RETURN_TRANSITION_INVALID', 'Choose a return request to inspect.');
    if (request.pending_operation) throw fault('RETURN_RECONCILIATION_REQUIRED', 'A refund or shipment operation needs review before continuing.');
    if (!['received', 'approved', 'refund_initiated', 'refunded'].includes(request.status)) throw fault('RETURN_TRANSITION_INVALID', 'Inspection is available after warehouse receipt.');
    const products = (await client.query(`SELECT id, inspection_status, inspection_reason, refund_amount
      FROM return_items WHERE return_request_id=$1 ORDER BY id FOR UPDATE`, [returnId])).rows;
    if (!products.length || decisions.some(item => !products.some(product => product.id === item.itemId))) throw fault('RETURN_INSPECTION_PENDING', 'Submit decisions for products in this request.');
    for (const product of products) {
      const decision = decisions.find(item => item.itemId === product.id);
      if (product.inspection_status !== 'pending') {
        if (decision && (product.inspection_status !== decision.decision || product.inspection_reason !== decision.reason)) throw fault('RETURN_ITEM_ALREADY_INSPECTED', 'A saved inspection decision cannot be changed.');
      } else {
        if (request.status !== 'received' || !decision) throw fault('RETURN_INSPECTION_PENDING', 'Approve or reject and enter a reason for every product.');
        await client.query(`UPDATE return_items SET inspection_status=$1, inspection_reason=$2,
          inspected_at=NOW(), inspected_by=$3 WHERE id=$4 AND return_request_id=$5`,
        [decision.decision, decision.reason, actorUserId, product.id, returnId]);
        await client.query(`INSERT INTO return_request_audit (return_request_id,order_id,actor_user_id,action,reason,metadata)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [returnId, request.order_id, actorUserId,
          decision.decision === 'approved' ? 'ITEM_RETURN_APPROVED' : 'ITEM_RETURN_REJECTED', decision.reason,
          JSON.stringify({ returnItemId: product.id })]);
        product.inspection_status = decision.decision;
      }
    }
    rejected = products.some(item => item.inspection_status === 'rejected');
    if (request.status === 'received' && !request.inventory_restored_at) {
      const approvedGrossPaise = products.filter(item => item.inspection_status === 'approved')
        .reduce((sum, item) => sum + Math.round(Number(item.refund_amount) * 100), 0);
      if (!Number.isSafeInteger(approvedGrossPaise) || approvedGrossPaise < 0) throw fault('RETURN_FINANCIAL_REVIEW', 'The refund amount needs review.');
      const deduction = request.request_type === 'return'
        ? Math.min(approvedGrossPaise, returns.returnShippingDeductionPaise(dependencies.env)) : 0;
      const net = approvedGrossPaise - deduction;
      const stock = (await client.query(`SELECT psd.id, psd.product_id, psd.size_id, SUM(ri.quantity)::integer AS quantity
        FROM return_items ri JOIN order_items oi ON oi.id=ri.order_item_id
        JOIN product_variants pv ON pv.id=oi.variant_id
        JOIN product_size_details psd ON psd.product_id=oi.product_id AND psd.size_id=pv.size_id
        WHERE ri.return_request_id=$1 AND ri.inspection_status='approved'
        GROUP BY psd.id,psd.product_id,psd.size_id ORDER BY psd.id`, [returnId])).rows;
      const missing = (await client.query(`SELECT ri.id FROM return_items ri JOIN order_items oi ON oi.id=ri.order_item_id
        LEFT JOIN product_variants pv ON pv.id=oi.variant_id
        LEFT JOIN product_size_details psd ON psd.product_id=oi.product_id AND psd.size_id=pv.size_id
        WHERE ri.return_request_id=$1 AND ri.inspection_status='approved' AND psd.id IS NULL`, [returnId])).rows;
      if (missing.length) throw fault('RETURN_INVENTORY_REVIEW', 'Approved return inventory needs review.');
      for (const item of stock) {
        const restored = (await client.query(`UPDATE product_size_details SET stock_quantity=stock_quantity+$1,
          updated_at=NOW() WHERE id=$2 RETURNING stock_quantity-$1 AS quantity_before, stock_quantity AS quantity_after`, [item.quantity, item.id])).rows[0];
        if (!restored) throw fault('RETURN_INVENTORY_REVIEW', 'Approved return inventory needs review.');
        await inventory.recordMovement(client, { inventoryId: item.id, productId: item.product_id, sizeId: item.size_id,
          movementType: 'RETURN_RESTOCKED', quantityChange: item.quantity, quantityBefore: restored.quantity_before,
          quantityAfter: restored.quantity_after, returnId, createdBy: actorUserId,
          reason: 'Return inspection approved', idempotencyKey: `RETURN_RESTOCKED:${returnId}:${item.id}` });
      }
      await client.query(`UPDATE return_requests SET refund_amount=$2,return_shipping_deduction=$3,
        inventory_restored_at=NOW(),status=$4,approved_at=COALESCE(approved_at,NOW()),
        refund_status=$5,updated_at=NOW() WHERE id=$1`, [returnId, (net / 100).toFixed(2), (deduction / 100).toFixed(2),
        rejected ? 'received' : 'approved', net ? (request.payment_method === 'cod' ? 'manual_required' : 'pending') : 'not_applicable']);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  if (rejected && !request.shiprocket_outbound_order_id) {
    await returns.createReplacementShipment(returnId, actorUserId, { ...dependencies, rejectedOnly: true });
  }
  const row = await returns.findReturn(database, returnId, null, true);
  if (Number(row.refund_amount) > 0 && row.status === 'approved' && ['pending', 'manual_required'].includes(row.refund_status)) {
    await returns.initiateRefund(returnId, dependencies);
  }
  return returns.formatReturn(await returns.findReturn(database, returnId, null, true));
}

module.exports = { submit };
