const test = require('node:test');
const assert = require('node:assert/strict');
const { createPoolConfig } = require('../config/db');

test('DATABASE_URL takes precedence without duplicating connection or SSL fields', () => {
  const connectionString =
    'postgresql://USER:PASSWORD@ep-example-pooler.neon.tech/monkhagen?sslmode=require&channel_binding=require';
  const config = createPoolConfig({
    DATABASE_URL: connectionString,
    DB_HOST: 'ignored-host',
    DB_PASSWORD: 'ignored-password',
    NODE_ENV: 'production'
  });

  assert.deepEqual(config, { connectionString });
  assert.equal('host' in config, false);
  assert.equal('password' in config, false);
  assert.equal('ssl' in config, false);
});

test('individual DB variables remain available for local development', () => {
  const config = createPoolConfig({
    DB_HOST: 'localhost',
    DB_PORT: '5433',
    DB_NAME: 'monkhagen_local',
    DB_USER: 'local_user',
    DB_PASSWORD: 'local_password',
    NODE_ENV: 'development'
  });

  assert.deepEqual(config, {
    host: 'localhost',
    port: 5433,
    database: 'monkhagen_local',
    user: 'local_user',
    password: 'local_password',
    ssl: false
  });
});

test('production fallback verifies PostgreSQL TLS certificates', () => {
  const config = createPoolConfig({ NODE_ENV: 'production' });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});
