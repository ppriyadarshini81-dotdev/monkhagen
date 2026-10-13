const { pool } = require('../config/db');
const r2 = require('../config/r2');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fault(status, message) { return Object.assign(new Error(message), { status, code: 'DEFECT_PHOTO_VALIDATION' }); }

async function upload(userId, orderId, itemId, files, { database = pool, storage = r2 } = {}) {
  if (!UUID.test(orderId) || !UUID.test(itemId) || !Array.isArray(files) || files.length < 1 || files.length > 2) throw fault(400, 'Upload one or two photos for this product.');
  const returns = require('./returnService');
  const eligibility = await returns.getEligibility(userId, orderId, database);
  const item = eligibility.items.find(row => row.orderItemId === itemId && row.remainingQuantity > 0);
  if (!item || !eligibility.requestTypes.some(type => type.code === 'defect' && type.eligible)) throw fault(409, 'This product is not available for a defective-item return.');
  const original = (await database.query(`SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE oi.id=$1 AND oi.order_id=$2 AND o.user_id=$3`, [itemId, orderId, userId])).rows[0];
  if (!original) throw fault(404, 'Order product not found.');
  const uploaded = [];
  const client = await database.connect();
  try {
    for (const file of files) uploaded.push({ ...(await storage.uploadPath(file, `ReturnDefectiveItem/${orderId}/${original.product_id || itemId}`)), mimeType: file.mimetype });
    await client.query('BEGIN');
    const photos = [];
    for (const image of uploaded) {
      const row = (await client.query(`INSERT INTO return_request_audit(order_id,actor_user_id,action,metadata)
        VALUES ($1,$2,'DEFECT_PHOTO_UPLOADED',$3::jsonb) RETURNING id`, [orderId, userId,
        JSON.stringify({ orderItemId: itemId, ...image })])).rows[0];
      photos.push({ id: row.id, url: image.url });
    }
    await client.query('COMMIT'); return photos;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await Promise.allSettled(uploaded.map(image => storage.deleteFile(image.key)));
    throw error;
  } finally { client.release(); }
}

async function attach(client, userId, orderId, selected, returnId) {
  const items = [];
  for (const item of selected) {
    const photos = (await client.query(`SELECT id,metadata FROM return_request_audit WHERE id=ANY($1::uuid[])
      AND order_id=$2 AND actor_user_id=$3 AND action='DEFECT_PHOTO_UPLOADED'`, [item.photoIds, orderId, userId])).rows;
    if (photos.length !== item.photoIds.length || photos.some(photo => photo.metadata.orderItemId !== item.orderItemId)) throw fault(400, 'Choose photos uploaded for this order product.');
    items.push({ orderItemId: item.orderItemId, photos: item.photoIds.map(id => {
      const photo = photos.find(row => row.id === id);
      return { id, url: photo.metadata.url, key: photo.metadata.key, mimeType: photo.metadata.mimeType };
    }) });
  }
  await client.query(`INSERT INTO return_request_audit(return_request_id,order_id,actor_user_id,action,metadata)
    VALUES ($1,$2,$3,'DEFECT_PHOTOS_ATTACHED',$4::jsonb)`, [returnId, orderId, userId, JSON.stringify({ items })]);
}

async function review(returnId, body, actorUserId, dependencies = {}) {
  const database = dependencies.database || pool;
  if (!UUID.test(returnId) || !['approved','rejected'].includes(body?.decision)) throw fault(400, 'Approve or reject the submitted photos.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 500 || body.decision === 'rejected' && !reason) throw fault(400, 'Add the rejection reason (maximum 500 characters).');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const request = (await client.query('SELECT * FROM return_requests WHERE id=$1 FOR UPDATE', [returnId])).rows[0];
    if (!request || request.request_type !== 'defect') throw fault(404, 'Defective-item request not found.');
    const previous = (await client.query(`SELECT action,metadata FROM return_request_audit WHERE return_request_id=$1
      AND action IN ('DEFECT_PHOTOS_ATTACHED','DEFECT_PHOTO_REVIEWED') ORDER BY created_at`, [returnId])).rows;
    if (!previous.some(row => row.action === 'DEFECT_PHOTOS_ATTACHED')) throw fault(409, 'This request has no submitted photos to review.');
    const existing = previous.find(row => row.action === 'DEFECT_PHOTO_REVIEWED');
    if (existing) {
      if (existing.metadata.decision !== body.decision || existing.metadata.reason !== reason) throw fault(409, 'The photo review has already been recorded.');
    } else {
      if (request.status !== 'requested' || request.pending_operation || request.shiprocket_return_order_id) throw fault(409, 'The return has already started or is closed.');
      await client.query(`INSERT INTO return_request_audit(return_request_id,order_id,actor_user_id,action,reason,metadata)
        VALUES ($1,$2,$3,'DEFECT_PHOTO_REVIEWED',$4,$5::jsonb)`, [returnId, request.order_id, actorUserId, reason || null,
        JSON.stringify({ decision: body.decision, reason })]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  const returns = require('./returnService');
  // Both photo-review outcomes start the requested physical return workflow.
  // The warehouse inspection remains the final refund decision.
  return returns.formatReturn(await returns.provisionReturn(returnId, dependencies));
}
module.exports = { upload, attach, review };
