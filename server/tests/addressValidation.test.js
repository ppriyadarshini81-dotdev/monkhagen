const test = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../services/addressValidation');

const address = { fullName: 'Test Customer', addressLine1: '12 Test Street', city: 'Delhi', state: 'Delhi', phone: '9876543210', email: 'buyer@example.test', postalCode: '110001', country: 'India' };

test('accepts a complete domestic delivery address', async () => {
  assert.equal(await validate(address, { validateLocation: true }), null);
});

test('rejects missing, whitespace-only and invalid delivery fields', async () => {
  assert.ok(await validate(undefined));
  assert.ok(await validate(null));
  assert.ok(await validate([]));
  for (const changes of [
    { fullName: '  ' }, { addressLine1: '' }, { city: 123 }, { state: '' },
    { phone: '1234567890' }, { phone: '98765' }, { email: '' }, { email: 'not-an-email' }, { postalCode: '000001' },
    { postalCode: 'abcdef' }, { country: 'USA' }
  ]) assert.ok(await validate({ ...address, ...changes }));
});

test('rejects mismatched Indian state and city pairs for new addresses', async () => {
  assert.match(await validate({ ...address, state: 'Haryana', city: 'Mumbai' }, { validateLocation: true }), /selected Indian state/i);
  assert.equal(await validate({ ...address, state: 'Haryana', city: 'Gurugram' }, { validateLocation: true }), null);
});

test('allows an unchanged legacy location but rejects changing it to another invalid pair', async () => {
  const legacy = { state: 'Legacy State', city: 'Old Township' };
  assert.equal(await validate({ ...address, ...legacy }, { validateLocation: true, legacyLocation: legacy }), null);
  assert.ok(await validate({ ...address, ...legacy, city: 'Another Town' }, { validateLocation: true, legacyLocation: legacy }));
});
