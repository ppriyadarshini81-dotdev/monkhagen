const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadPackages = require('../config/shippingPackages');
const { packageForItems, packageDetails } = require('../services/shippingMapping');
const { profiles, environment } = require('./helpers/shippingPackageFixtures');
const configurationError = error => error.code === 'SHIPPING_PACKAGE_NOT_CONFIGURED' && error.status === 503;

test('environment measurements and quantity thresholds control packing with no code defaults', () => {
  const custom = { SHIPROCKET_PACKAGE_PROFILES: JSON.stringify([
    { minimumQuantity: 1, maximumQuantity: 2, weight: 0.66, length: 31, breadth: 35, height: 4 },
    { minimumQuantity: 3, maximumQuantity: null, weight: 1.7, length: 40, breadth: 42, height: 10 }
  ]) };
  assert.equal(packageForItems([{ quantity: 2 }], custom).weight, 0.66);
  assert.equal(packageForItems([{ quantity: 3 }], custom).height, 10);
  assert.equal(packageForItems([{ quantity: 1 }], environment).length, 27);
  assert.throws(() => packageForItems([{ quantity: 1 }], {}), configurationError);
  assert.deepEqual(packageDetails({ pickup_location: 'work', weight: 2, length: 40, breadth: 40, height: 10 }, {}, [{ quantity: 1 }]),
    { pickup_location: 'work', weight: 2, length: 40, breadth: 40, height: 10 });
});

test('missing, malformed, overlapping, incomplete and invalid profiles fail safely', () => {
  for (const value of [undefined, '', 'invalid', '{}', '[]', 'null', '[null]', JSON.stringify([{ ...profiles[0], weight: true }]),
    JSON.stringify([{ ...profiles[0], maximumQuantity: null, height: 0 }]),
    JSON.stringify([{ ...profiles[0], maximumQuantity: null, weight: '0.3' }]),
    JSON.stringify(profiles.slice(0, -1)),
    JSON.stringify(profiles.map((row, index) => index === 1 ? { ...row, minimumQuantity: 1 } : row)),
    JSON.stringify(profiles.map((row, index) => index === 1 ? { ...row, minimumQuantity: 3, maximumQuantity: 3 } : row))]) {
    assert.throws(() => loadPackages({ SHIPROCKET_PACKAGE_PROFILES: value }), configurationError);
  }
});
