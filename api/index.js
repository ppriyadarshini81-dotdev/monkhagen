require('dotenv').config({ quiet: true });
const { connectDB } = require('../server/config/db');
const { createApp } = require('../server/app');
const app = createApp();
let ready;
module.exports = async function handler(req, res) {
  const unavailable = () => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ message: 'Service is temporarily unavailable.' }));
  };
  // Express must own parsing, especially the exact signed webhook body. Vercel
  // helpers can preparse request.body; require their documented opt-out.
  if (process.env.VERCEL && process.env.NODEJS_HELPERS !== '0') return unavailable();
  // Reuse the pool and initialization promise on warm invocations. Never
  // run migrations or detached background workers in serverless runtime.
  ready ||= connectDB({ migrate: false }).catch(error => { ready = null; throw error; });
  try { await ready; }
  catch { return unavailable(); }
  return app(req, res);
};
