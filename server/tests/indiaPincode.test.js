const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPincodeMatchesLocation, lookupPincode, matchesCity, matchesState } = require('../services/indiaPincode');

test('PIN location matching accepts a post office district or office in the selected city and state', () => {
  const office = { Name: 'Ludhiana HO', District: 'Ludhiana', State: 'Punjab' };
  assert.equal(matchesCity(office, 'Ludhiana'), true);
  assert.equal(matchesState(office, 'Punjab'), true);
  assert.equal(matchesCity(office, 'Amritsar'), false);
  assert.equal(matchesState(office, 'Haryana'), false);
  assert.equal(matchesCity({ District: 'Gurgaon' }, 'Gurugram'), true);
});

test('valid PIN returns its postal city/state while invalid, mismatched and unavailable lookups are distinct', async () => {
  const success = async () => ({ ok: true, json: async () => [{ Status: 'Success', PostOffice: [{ Name: 'Bangalore', District: 'Bengaluru', State: 'Karnataka' }] }] });
  const result = await lookupPincode('560012', success);
  assert.deepEqual({ postalCode: result.postalCode, city: result.city, state: result.state }, { postalCode: '560012', city: 'Bengaluru', state: 'Karnataka' });
  await assert.rejects(assertPincodeMatchesLocation({ postalCode: '560012', city: 'Ludhiana', state: 'Punjab' }, success), error => error.code === 'PINCODE_LOCATION_MISMATCH');
  await assert.rejects(lookupPincode('000000', success), error => error.code === 'PINCODE_INVALID');
  await assert.rejects(lookupPincode('560013', async () => { throw new Error('offline'); }), error => error.code === 'PINCODE_VERIFICATION_UNAVAILABLE' && error.status === 503);
});
