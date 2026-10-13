const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('after-sales schema migration contains no historical data backfill and is recorded separately', () => {
  const schema = readFileSync(path.join(__dirname, '..', 'migrations', '027_after_sales_orders_schema.sql'), 'utf8');
  const legacy = readFileSync(path.join(__dirname, '..', 'migrations', '027_after_sales_orders.sql'), 'utf8');
  const runner = readFileSync(path.join(__dirname, '..', 'config', 'db.js'), 'utf8');

  const executableSql = schema.replace(/^--.*$/gm, '');
  assert.doesNotMatch(executableSql, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|COPY)\b/gim);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS order_type/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS fulfillment_type/);
  assert.match(legacy, /INSERT INTO orders/i);
  assert.match(runner, /runMigration\('027_after_sales_orders_schema', applyAfterSalesOrdersSchemaMigration\)/);
  assert.doesNotMatch(runner, /runMigration\('027_after_sales_orders', applyAfterSalesOrdersMigration\)/);
});
