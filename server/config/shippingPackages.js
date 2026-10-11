const { shippingError } = require('./shiprocket');

function configurationError() {
  return shippingError(503, 'SHIPPING_PACKAGE_NOT_CONFIGURED',
    'Configure valid quantity-based packing profiles in the backend environment.');
}

function shippingPackages(environment = process.env) {
  let profiles;
  try { profiles = JSON.parse(environment.SHIPROCKET_PACKAGE_PROFILES); }
  catch { throw configurationError(); }
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 100) throw configurationError();
  const result = profiles.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        !Number.isSafeInteger(row.minimumQuantity) || row.minimumQuantity < 1 ||
        (row.maximumQuantity !== null && (!Number.isSafeInteger(row.maximumQuantity) || row.maximumQuantity < row.minimumQuantity))) throw configurationError();
    for (const field of ['weight', 'length', 'breadth', 'height']) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] <= 0 || row[field] > 1000) throw configurationError();
    }
    if (row.volumetricWeightKg != null && (typeof row.volumetricWeightKg !== 'number' || !Number.isFinite(row.volumetricWeightKg) || row.volumetricWeightKg <= 0)) throw configurationError();
    return { minimumQuantity: row.minimumQuantity, maximumQuantity: row.maximumQuantity,
      weight: row.weight, length: row.length, breadth: row.breadth, height: row.height };
  }).sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  // Cover every positive quantity exactly once, including a final open tier.
  if (result[0].minimumQuantity !== 1 || result.at(-1).maximumQuantity !== null) throw configurationError();
  for (let index = 1; index < result.length; index++) {
    if (result[index - 1].maximumQuantity === null || result[index - 1].maximumQuantity + 1 !== result[index].minimumQuantity) throw configurationError();
  }
  return result;
}

module.exports = shippingPackages;
