const test = require('node:test');
const assert = require('node:assert/strict');
const { assertProductionDatabaseRole } = require('../config/databasePermissions');
test('production refuses privileged, owner and schema-create database roles without altering grants', async () => {
  for (const field of ['dangerous_role','schema_create','schema_owner','object_owner']) {
    let statement;
    await assert.rejects(assertProductionDatabaseRole({ query: async sql => { statement = sql; return { rows: [{ [field]: true }] }; } },
      { NODE_ENV: 'production' }), error => error.code === 'DB_ROLE_UNSAFE');
    assert.match(statement, /^SELECT/);
    assert.doesNotMatch(statement, /GRANT|REVOKE|ALTER ROLE|CREATE ROLE/i);
    assert.match(statement, /pg_has_role/);
  }
});
test('restricted runtime role passes; local owner-based development is preserved', async () => {
  await assertProductionDatabaseRole({ query: async () => ({ rows: [{ dangerous_role: false, schema_create: false, schema_owner: false, object_owner: false }] }) }, { NODE_ENV: 'production' });
  await assertProductionDatabaseRole({ query: async () => { throw new Error('must not query'); } }, { NODE_ENV: 'development' });
});
test('missing production role verification fails closed', async () => {
  await assert.rejects(assertProductionDatabaseRole({ query: async () => ({ rows: [] }) }, { NODE_ENV: 'production' }), /restricted application role/);
});
