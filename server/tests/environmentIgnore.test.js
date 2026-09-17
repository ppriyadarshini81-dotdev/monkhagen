const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const workspace = path.join(__dirname, '..', '..');

test('environment variants and Vercel local configuration are ignored without creating files', () => {
  const names = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development',
    '.env.backup', 'server/.env', 'server/.env.staging', 'credentials.env', '.vercel/project.json'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: workspace, input: names.join('\n') + '\n', encoding: 'utf8'
  }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, names);
});
