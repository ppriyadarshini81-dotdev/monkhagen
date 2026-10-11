// Test fixture only. Runtime measurements must come from the environment.
const profiles = [
  { minimumQuantity: 1, maximumQuantity: 1, weight: 0.3, length: 27, breadth: 33, height: 2.6 },
  { minimumQuantity: 2, maximumQuantity: 2, weight: 0.57, length: 29.21, breadth: 33.02, height: 3.81 },
  { minimumQuantity: 3, maximumQuantity: 3, weight: 0.83, length: 29.21, breadth: 33.02, height: 5.08 },
  { minimumQuantity: 4, maximumQuantity: 4, weight: 1.1, length: 30.5, breadth: 33.02, height: 7.15 },
  { minimumQuantity: 5, maximumQuantity: null, weight: 1.45, length: 33.02, breadth: 33.02, height: 8.9 }
];
module.exports = { profiles, environment: { SHIPROCKET_PRODUCT_TAX_PERCENT: '5', SHIPROCKET_PACKAGE_PROFILES: JSON.stringify(profiles) } };
