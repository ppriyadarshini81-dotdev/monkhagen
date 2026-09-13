const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('PostgreSQL migration is repeatable, queue insertion is transactional, and duplicate mappings are rejected',
  { skip: process.env.SHIPPING_DB_TESTS !== '1' }, async () => {
    require('dotenv').config({ quiet: true });
    const { pool } = require('../config/db');
    const Shipment = require('../models/Shipment');
    const client = await pool.connect();
    // All test objects/data live in a separate schema in a transaction that is rolled back.
    const schema = `shipping_test_${crypto.randomBytes(8).toString('hex')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query(`CREATE TABLE orders (
        id UUID PRIMARY KEY, awb_number TEXT, courier_name TEXT, tracking_url TEXT,
        shipped_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, order_status TEXT DEFAULT 'confirmed', updated_at TIMESTAMPTZ
      )`);
      const sql = readFileSync(path.join(__dirname, '..', 'migrations', '001_shipments.sql'), 'utf8');
      await client.query(sql);
      await client.query(sql);
      const orderId = crypto.randomUUID();
      await client.query('INSERT INTO orders (id) VALUES ($1)', [orderId]);
      await client.query('SAVEPOINT payment');
      await Shipment.enqueue(client, orderId);
      await Shipment.enqueue(client, orderId);
      assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM shipments')).rows[0].count, 1);
      await client.query('ROLLBACK TO SAVEPOINT payment');
      assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM shipments')).rows[0].count, 0);
      await Shipment.enqueue(client, orderId);
      await client.query('UPDATE shipments SET shiprocket_order_id = 101, shiprocket_shipment_id = 202 WHERE order_id = $1', [orderId]);
      const other = crypto.randomUUID();
      await client.query('INSERT INTO orders (id) VALUES ($1)', [other]);
      await client.query('SAVEPOINT duplicates');
      await assert.rejects(client.query('INSERT INTO shipments (order_id, shiprocket_order_id, shiprocket_shipment_id) VALUES ($1,101,203)', [other]), error => error.code === '23505');
      await client.query('ROLLBACK TO SAVEPOINT duplicates');
      await assert.rejects(client.query('INSERT INTO shipments (order_id, package_weight) VALUES ($1,-1)', [other]), error => error.code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT duplicates');
      await Shipment.withLock(orderId, async () => {
        await assert.rejects(Shipment.withLock(orderId, async () => {}), error => error.code === 'SHIPPING_BUSY');
      });
      await Shipment.withLock(orderId, async () => {});
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
