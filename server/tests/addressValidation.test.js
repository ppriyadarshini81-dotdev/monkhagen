const test = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../services/addressValidation');

const address = { fullName: 'Test Customer', addressLine1: '12 Test Street', city: 'Delhi', state: 'Delhi', phone: '9876543210', postalCode: '110001', country: 'India' };

test('accepts a complete domestic delivery address', () => {
  assert.equal(validate(address), null);
});

test('rejects missing, whitespace-only and invalid delivery fields', () => {
  assert.ok(validate(undefined));
  assert.ok(validate(null));
  assert.ok(validate([]));
  for (const changes of [
    { fullName: '  ' }, { addressLine1: '' }, { city: 123 }, { state: '' },
    { phone: '1234567890' }, { phone: '98765' }, { postalCode: '000001' },
    { postalCode: 'abcdef' }, { country: 'USA' }
  ]) assert.ok(validate({ ...address, ...changes }));
});
