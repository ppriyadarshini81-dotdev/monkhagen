const asyncHandler = require('../middleware/asyncHandler');
const reports = require('../services/analyticsReportService');

for (const name of ['overview', 'revenue', 'funnel', 'products', 'carts', 'payments', 'visitors',
  'logins', 'returns', 'errors', 'trend', 'drilldown']) {
  exports[name] = asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await reports[name](req.query));
  });
}
