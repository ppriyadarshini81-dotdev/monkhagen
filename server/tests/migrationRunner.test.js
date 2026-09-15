const test = require('node:test');
const assert = require('node:assert/strict');
const { runMigration } = require('../config/db');

function fakePool(existingRows) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).startsWith('SELECT 1 FROM schema_migrations')) {
        return { rows: existingRows };
      }
      return { rows: [] };
    },
    release() { released = true; }
  };
  return {
    queries,
    get released() { return released; },
    async connect() { return client; }
  };
}

test('migration runner applies and records a pending migration transactionally', async () => {
  const database = fakePool([]);
  let applications = 0;
  const applied = await runMigration('test_pending', async (client) => {
    applications += 1;
    await client.query('CREATE TABLE test_table (id INT)');
  }, database);

  assert.equal(applied, true);
  assert.equal(applications, 1);
  assert.ok(database.queries.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(database.queries.some(({ sql }) => sql.startsWith('INSERT INTO schema_migrations')));
  assert.ok(database.queries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(database.released, true);
});

test('migration runner skips a migration already recorded', async () => {
  const database = fakePool([{ '?column?': 1 }]);
  let applications = 0;
  const applied = await runMigration('test_existing', async () => {
    applications += 1;
  }, database);

  assert.equal(applied, false);
  assert.equal(applications, 0);
  assert.equal(database.released, true);
});
