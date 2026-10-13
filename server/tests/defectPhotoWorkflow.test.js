const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const photos = require('../services/defectPhotoService');
const returns = require('../services/returnService');
const packing = require('./helpers/shippingPackageFixtures').environment;
const ORDER = '10000000-0000-4000-8000-000000000001';
const ITEM = '20000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const RETURN = '40000000-0000-4000-8000-000000000001';
const PHOTO = '90000000-0000-4000-8000-000000000001';
const IDEM = '50000000-0000-4000-8000-000000000001';

test('defective items require one or two distinct uploaded photo IDs', () => {
  const body = { orderId: ORDER, idempotencyKey: IDEM, requestType: 'defect',
    items: [{ orderItemId: ITEM, quantity: 1, reason: 'quality_issue', comments: 'Torn fabric' }] };
  for (const photoIds of [undefined, [], [PHOTO, PHOTO], [PHOTO, 'not-an-id'], [PHOTO, PHOTO, PHOTO]]) {
    assert.throws(() => returns.validateRequest({ ...body, items: [{ ...body.items[0], photoIds }] }));
  }
  assert.deepEqual(returns.validateRequest({ ...body, items: [{ ...body.items[0], photoIds: [PHOTO] }] }).items[0].photoIds, [PHOTO]);
});

test('upload validates the owned order product and records only scoped R2 keys', async () => {
  const calls = [];
  const query = async (sql, args) => {
    if (sql.startsWith('SELECT o.*')) return { rows: args[1] === USER ? [{ id: ORDER, order_status: 'delivered', delivered_at: new Date(), subtotal: 1499, discount_amount: 0 }] : [] };
    if (sql.startsWith('SELECT oi.*')) return { rows: [{ id: ITEM, product_name: 'Test tee', size: 'M', quantity: 1, unit_price: 1499 }] };
    if (sql.startsWith('SELECT oi.product_id')) return { rows: args[2] === USER && args[0] === ITEM ? [{ product_id: IDEM }] : [] };
    if (sql.startsWith('INSERT INTO return_request_audit')) { calls.push(args); return { rows: [{ id: PHOTO }] }; }
    return { rows: [] };
  };
  const database = { query, connect: async () => ({ query, release() {} }) };
  const uploads = [];
  const storage = { uploadPath: async (file, folder) => { uploads.push(folder); return { key: `${folder}/photo.png`, url: `https://media.example/${folder}/photo.png` }; }, deleteFile: async () => {} };
  const files = [{ path: 'test.png', mimetype: 'image/png' }];
  await assert.rejects(photos.upload(IDEM, ORDER, ITEM, files, { database, storage }));
  await assert.rejects(photos.upload(USER, ORDER, IDEM, files, { database, storage }));
  await assert.rejects(photos.upload(USER, ORDER, ITEM, [files[0], files[0], files[0]], { database, storage }));
  assert.equal(uploads.length, 0);
  const result = await photos.upload(USER, ORDER, ITEM, files, { database, storage });
  assert.equal(result.length, 1); assert.equal(result[0].id, PHOTO);
  assert.equal(uploads[0], `ReturnDefectiveItem/${ORDER}/${IDEM}`);
  assert.equal(JSON.parse(calls[0][2]).orderItemId, ITEM);
});

test('photo attachment verifies the stored uploader, original order and product before binding evidence', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE return_request_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,
      actor_user_id uuid,return_request_id uuid,action text,metadata jsonb,reason text,created_at timestamptz DEFAULT NOW());`);
    await db.query(`INSERT INTO return_request_audit(id,order_id,actor_user_id,action,metadata)
      VALUES ($1,$2,$3,'DEFECT_PHOTO_UPLOADED',$4::jsonb)`, [PHOTO, ORDER, USER,
      JSON.stringify({ orderItemId: ITEM, key: `ReturnDefectiveItem/${ORDER}/${ITEM}/test.png`, url: 'https://media.example/test.png', mimeType: 'image/png' })]);
    await assert.rejects(photos.attach(db, IDEM, ORDER, [{ orderItemId: ITEM, photoIds: [PHOTO] }], RETURN));
    await assert.rejects(photos.attach(db, USER, IDEM, [{ orderItemId: ITEM, photoIds: [PHOTO] }], RETURN));
    await assert.rejects(photos.attach(db, USER, ORDER, [{ orderItemId: IDEM, photoIds: [PHOTO] }], RETURN));
    await photos.attach(db, USER, ORDER, [{ orderItemId: ITEM, photoIds: [PHOTO] }], RETURN);
    const evidence = (await db.query("SELECT metadata FROM return_request_audit WHERE action='DEFECT_PHOTOS_ATTACHED'")).rows[0].metadata;
    assert.equal(evidence.items[0].photos.length, 1);
    const formatted = returns.formatReturn({ status: 'requested', items: [{ orderItemId: ITEM }], defect_photo_evidence: evidence });
    assert.equal(formatted.defectPhotoReviewPending, true);
    assert.deepEqual(formatted.items[0].defectPhotos, [{ id: PHOTO, url: 'https://media.example/test.png' }]);
  } finally { await db.close(); }
});

test('Shiprocket creation stays blocked until admin photo review; either review decision starts pickup exactly once', async () => {
  for (const decision of ['approved', 'rejected']) {
    const db = new PGlite(); const calls = [];
    try {
      await db.exec(`CREATE TABLE return_requests(id uuid PRIMARY KEY,order_id uuid,request_type text,status text,
        return_number text,shiprocket_return_order_id bigint,shiprocket_return_shipment_id bigint,
        pending_operation text,operation_started_at timestamptz,attempt_count integer DEFAULT 0,last_error_code text,
        return_awb text,pickup_status text,updated_at timestamptz);
        CREATE TABLE return_request_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,
          actor_user_id uuid,return_request_id uuid,action text,metadata jsonb,reason text,created_at timestamptz DEFAULT NOW());`);
      await db.query("INSERT INTO return_requests(id,order_id,request_type,status,return_number) VALUES ($1,$2,'defect','requested','R-test')", [RETURN, ORDER]);
      await db.query("INSERT INTO return_request_audit(return_request_id,order_id,action,metadata) VALUES ($1,$2,'DEFECT_PHOTOS_ATTACHED','{}')", [RETURN, ORDER]);
      const query = async (sql, args) => {
        if (sql.startsWith('SELECT rr.id, rr.return_number')) return { rows: [{ id: RETURN, return_number: 'R-test', customer_email: 'test@example.com',
          full_name: 'Test buyer', address_line1: 'Test home', city: 'Delhi', state: 'Delhi', postal_code: '110001', phone: '9876543210',
          items: [{ sku: 'TEE-M', id: ITEM, name: 'Test tee', size: 'M', quantity: 1, unitPrice: 1499, refundAmount: 1499 }] }] };
        if (sql.startsWith('SELECT rr.*, o.order_number')) {
          const row = (await db.query('SELECT * FROM return_requests WHERE id=$1', [RETURN])).rows[0];
          return { rows: [{ ...row, refund_amount: 1499, return_shipping_deduction: 0, items: [] }] };
        }
        return db.query(sql, args);
      };
      const database = { query, connect: async () => ({ query, release() {} }) };
      const api = { request: async (path, options) => {
        if (path === '/settings/company/pickup') return { data: { shipping_address: [{ pickup_location: 'work', name: 'Test warehouse',
          address: 'Warehouse', city: 'Delhi', state: 'Delhi', country: 'India', pin_code: '110001', email: 'test@example.com', phone: '9876543210' }] } };
        assert.equal(path, '/orders/create/return'); calls.push(options.body); return { order_id: 11, shipment_id: 22 };
      } };
      const dependencies = { database, api, env: { ...packing, SHIPROCKET_PICKUP_LOCATION: 'work' } };
      await returns.provisionReturn(RETURN, dependencies); assert.equal(calls.length, 0);
      if (decision === 'rejected') await assert.rejects(photos.review(RETURN, { decision, reason: '' }, USER, dependencies));
      const input = { decision, reason: decision === 'rejected' ? 'Needs physical inspection' : '' };
      const result = await photos.review(RETURN, input, USER, dependencies);
      assert.equal(result.status, 'return_created'); assert.equal(result.returnShippingDeduction, 0);
      assert.equal(calls.length, 1);
      await photos.review(RETURN, input, USER, dependencies); assert.equal(calls.length, 1);
      await assert.rejects(photos.review(RETURN, { decision: decision === 'approved' ? 'rejected' : 'approved', reason: 'Changed' }, USER, dependencies));
    } finally { await db.close(); }
  }
});
