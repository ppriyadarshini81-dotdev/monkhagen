require('dotenv').config({ quiet: true });
const reports = require('./services/analyticsReportService');
const { pool } = require('./config/db');

// Read-only smoke check. It reports structure/counts only and never emits
// customer, order, payment, credential or connection-string values.
(async () => {
  try {
    const values = await Promise.all([
      reports.overview({ range: '7d' }), reports.revenue({ range: '7d' }),
      reports.funnel({ range: '7d' }), reports.products({ range: '7d' }),
      reports.carts({ range: '7d' }), reports.payments({ range: '7d' }),
      reports.visitors({ range: '7d' })
    ]);
    console.log(JSON.stringify({
      ready: Boolean(values[0].metrics), revenue_points: values[1].points.length,
      funnel_stages: values[2].stages.length, products: values[3].products.length,
      carts: values[4].carts.length, payment_issues: values[5].issues.length,
      hourly_buckets: values[6].hourly.length
    }));
  } catch (error) {
    console.error('Analytics read-only check failed.', { code: error.code || 'ANALYTICS_CHECK_FAILED' });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
