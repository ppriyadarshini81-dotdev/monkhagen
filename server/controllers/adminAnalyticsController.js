const asyncHandler = require('../middleware/asyncHandler');
const reports = require('../services/analyticsReportService');

// A dashboard visit consumes one admin request, rather than eleven separate
// requests competing with orders, returns and the rest of the admin portal.
exports.dashboard = asyncHandler(async (req, res) => {
  const names = ['overview', 'revenue', 'funnel', 'products', 'carts', 'payments',
    'visitors', 'trend', 'logins', 'returns', 'errors'];
  const entries = await Promise.all(names.map(async name => [name, await reports[name](req.query)]));
  res.set('Cache-Control', 'no-store');
  res.json(Object.fromEntries(entries));
});

for (const name of ['overview', 'revenue', 'funnel', 'products', 'carts', 'payments', 'visitors',
  'logins', 'returns', 'errors', 'trend', 'drilldown']) {
  exports[name] = asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await reports[name](req.query));
  });
}
