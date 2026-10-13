const asyncHandler = require('../middleware/asyncHandler');
const { pool } = require('../config/db');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.subscribe = asyncHandler(async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }

  await pool.query(`
    INSERT INTO newsletter_subscribers (email, subscribed_at, unsubscribed_at, updated_at)
    VALUES ($1, NOW(), NULL, NOW())
    ON CONFLICT (LOWER(email)) DO UPDATE
      SET subscribed_at = NOW(), unsubscribed_at = NULL, updated_at = NOW()
  `, [email]);

  res.status(201).json({ message: 'You are on the list. We will let you know about the next drop.' });
});

exports.unsubscribe = asyncHandler(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return res.status(400).json({ message: 'This unsubscribe link is invalid.' });
  }
  await pool.query(`UPDATE newsletter_subscribers
    SET unsubscribed_at = NOW(), updated_at = NOW() WHERE unsubscribe_token = $1`, [token]);
  res.json({ message: 'You have been unsubscribed from new-arrival emails.' });
});
