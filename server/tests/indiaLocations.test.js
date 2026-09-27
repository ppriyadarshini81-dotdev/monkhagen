const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIndiaLocations, resolveIndiaLocation } = require('../services/indiaLocations');

test('India location data contains all states and union territories in alphabetical order', async () => {
  const locations = await loadIndiaLocations();
  assert.equal(locations.country, 'India');
  assert.equal(locations.states.length, 36);
  assert.deepEqual(locations.states.map(state => state.name),
    [...locations.states.map(state => state.name)].sort((a, b) => a.localeCompare(b, 'en-IN')));
});

test('Haryana and Punjab expose their own city options', async () => {
  const locations = await loadIndiaLocations();
  const haryana = locations.states.find(state => state.name === 'Haryana');
  const punjab = locations.states.find(state => state.name === 'Punjab');
  assert.ok(haryana.cities.includes('Gurugram'));
  assert.ok(haryana.cities.includes('Faridabad'));
  assert.ok(punjab.cities.includes('Amritsar'));
  assert.ok(!punjab.cities.includes('Gurugram'));
  assert.deepEqual(await resolveIndiaLocation('haryana', 'gurugram'), { state: 'Haryana', city: 'Gurugram' });
});
