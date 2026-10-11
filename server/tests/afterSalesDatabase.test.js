const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');

test('PostgreSQL links an inspected parcel to one zero-charge outbound order and tracks it inside the same return',
  { skip: process.env.AFTER_SALES_DB_TESTS !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    const { pool } = require('../config/db');
    const { submitReplacementInspection, findReturn, formatReturn, listAdminReturns, getEligibility, rejectReturn } = require('../services/returnService');
    const { processForwardWebhook } = require('../services/shippingWebhookService');
    const client = await pool.connect();
    const schema = `after_sales_test_${randomBytes(8).toString('hex')}`;
    try {
      await client.query('BEGIN');
      const sourceSchema = (await client.query('SELECT current_schema() AS name')).rows[0].name.replace(/"/g, '""');
      await client.query(`CREATE SCHEMA "${schema}"`);
      const tables = ['users', 'products', 'sizes', 'product_variants', 'product_size_details', 'product_images', 'orders',
        'order_addresses', 'order_items', 'return_requests', 'return_items', 'cod_refund_destinations',
        'return_request_audit', 'inventory_movements', 'shipments', 'return_webhook_events', 'shipment_webhook_events'];
      for (const table of tables) await client.query(`CREATE TABLE "${schema}".${table} (LIKE "${sourceSchema}".${table} INCLUDING ALL)`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      const buyer = randomUUID(), admin = randomUUID(), product = randomUUID(), purchase = randomUUID(), request = randomUUID();
      await client.query(`INSERT INTO users (id, role_id, name, email) VALUES ($1,$2,'Buyer','buyer@example.com'),($3,$2,'Admin','admin@example.com')`, [buyer, randomUUID(), admin]);
      await client.query(`INSERT INTO products (id, category_id, name, slug, base_price) VALUES ($1,$2,'Test tee','test-tee',100)`, [product, randomUUID()]);
      const sizes = (await client.query("INSERT INTO sizes (name) VALUES ('M'),('L') RETURNING id, name")).rows;
      const medium = sizes.find(size => size.name === 'M').id, large = sizes.find(size => size.name === 'L').id;
      const variants = (await client.query(`INSERT INTO product_variants (product_id, size, color, size_id, sku)
        VALUES ($1,'M','Black',$2,'TEST-M'),($1,'L','Black',$3,'TEST-L') RETURNING id,size`, [product, medium, large])).rows;
      await client.query(`INSERT INTO product_size_details (product_id,size_id,stock_quantity,inventory_configured,is_active)
        VALUES ($1,$2,1,TRUE,TRUE),($1,$3,5,TRUE,TRUE)`, [product,medium,large]);
      await client.query(`INSERT INTO orders (id,user_id,order_number,subtotal,total_amount,payment_method,payment_status,order_status,delivered_at)
        VALUES ($1,$2,'TEST-PURCHASE',200,200,'razorpay','paid','delivered',NOW())`, [purchase,buyer]);
      await client.query(`INSERT INTO order_addresses (order_id,full_name,phone,email,address_line1,city,state,postal_code)
        VALUES ($1,'Buyer Name','9876543210','buyer@example.com','Customer Home','Mumbai','Maharashtra','400001')`, [purchase]);
      const originals = (await client.query(`INSERT INTO order_items (order_id,product_id,variant_id,product_name,sku,size,color,quantity,unit_price,total_price)
        VALUES ($1,$2,$3,'Test tee','TEST-M','M','Black',1,100,100),($1,$2,$3,'Test tee','TEST-M','M','Black',1,100,100) RETURNING id`,
      [purchase,product,variants.find(variant=>variant.size==='M').id])).rows;
      await client.query(`INSERT INTO return_requests (id,order_id,user_id,return_number,request_type,status,refund_status)
        VALUES ($1,$2,$3,'R-TEST','replacement','requested','not_applicable')`, [request,purchase,buyer]);
      const items = (await client.query(`INSERT INTO return_items (return_request_id,order_item_id,quantity,replacement_size)
        VALUES ($1,$2,1,'L'),($1,$3,1,'L') RETURNING id`, [request,originals[0].id,originals[1].id])).rows;
      // Application transaction boundaries become savepoints in this rollback-only
      // test. No pooled connection can escape the isolated schema/transaction.
      const scoped = { release() {}, query: (sql, params) => {
        if (sql === 'BEGIN') return client.query('SAVEPOINT application_operation');
        if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT application_operation');
        if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT application_operation');
        return client.query(sql, params);
      } };
      const database = { query: scoped.query, connect: async () => scoped };
      const blocked = await getEligibility(buyer,purchase,database);
      assert.equal(blocked.hasExistingRequest,true);
      await rejectReturn(request,{ database,confirmedNoRemote:true,api:{ request:()=>{ throw new Error('Local cancellation must not call a provider'); } } });
      const cancelled = await getEligibility(buyer,purchase,database);
      assert.equal(cancelled.hasExistingRequest,false);
      assert.equal(cancelled.eligible,true);
      // Prepare a received fixture for the independent outbound shipping scenario.
      await client.query("UPDATE return_requests SET status='received', rejected_at=NULL WHERE id=$1",[request]);
      const env = { ...require('./helpers/shippingPackageFixtures').environment, SHIPROCKET_PICKUP_LOCATION: 'work', SHIPROCKET_PACKAGE_WEIGHT_KG: '0.5',
        SHIPROCKET_PACKAGE_LENGTH_CM: '20', SHIPROCKET_PACKAGE_BREADTH_CM: '15', SHIPROCKET_PACKAGE_HEIGHT_CM: '5', SHIPROCKET_WEBHOOK_SECRET: 'test-secret' };
      const calls = [];
      const api = { request: async (path, options) => {
        if (path === '/settings/company/pickup') return { data: { shipping_address: [{ pickup_location:'work', name:'Monk Hagen',
          address:'Warehouse', city:'Delhi', state:'Delhi', country:'India', pin_code:'110001', email:'returns@example.com', phone:'9876543210' }] } };
        assert.equal(path,'/orders/create/adhoc'); calls.push(options.body); return { order_id:123,shipment_id:456 };
      } };
      const input = { items: [{ itemId:items[0].id,decision:'approved',reason:'Passed inspection' },
        { itemId:items[1].id,decision:'rejected',reason:'Fabric damaged' }] };
      const returned = await submitReplacementInspection(request,input,admin,{ database,api,env });
      assert.ok(returned.outboundOrder.id); assert.equal(returned.outboundOrder.orderType,'replacement');
      const child = (await client.query('SELECT * FROM orders WHERE return_request_id=$1',[request])).rows[0];
      assert.equal(child.source_order_id,purchase); assert.equal(child.created_by,admin); assert.equal(Number(child.total_amount),0);
      assert.equal(calls[0].order_id,child.id);
      const snapshot = (await client.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY fulfillment_type',[child.id])).rows;
      assert.deepEqual(snapshot.map(item=>[item.fulfillment_type,item.size]),[['rejected_return','M'],['replacement','L']]);
      assert.equal(snapshot[0].inspection_reason,'Fabric damaged');
      assert.equal((await listAdminReturns(database,{ tab:'completed' })).length,0);
      await submitReplacementInspection(request,input,admin,{ database,api,env }); assert.equal(calls.length,1);
      assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM orders WHERE user_id=$1 AND order_type='normal'",[buyer])).rows[0].count,1);
      await processForwardWebhook({ order_id:child.id,awb:'TEST-AWB',shipment_status:'PICKUP SCHEDULED' },{ 'x-api-key':'test-secret' },database,env);
      assert.equal((await listAdminReturns(database,{ tab:'completed' })).length,1);
      await processForwardWebhook({ order_id:child.id,awb:'TEST-AWB',shipment_status:'DELIVERED' },{ 'x-api-key':'test-secret' },database,env);
      const updated = formatReturn(await findReturn(database,request,buyer));
      assert.equal(updated.outboundStage,5); assert.equal(updated.outboundOrder.status,'delivered');
      assert.equal(updated.items.find(item=>item.id===items[1].id).inspectionReason,'Fabric damaged');
    } finally {
      await client.query('ROLLBACK'); client.release(); await pool.end();
    }
  });
