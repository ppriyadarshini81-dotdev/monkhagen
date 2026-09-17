const asyncHandler = require('../middleware/asyncHandler');
const { getTransporter } = require('../config/mailer');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.sendQuery = asyncHandler(async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';

  if (!name || !email || !query) {
    return res.status(400).json({ message: 'Name, email, and query are required.' });
  }
  if (name.length > 120) {
    return res.status(400).json({ message: 'Name must be 120 characters or fewer.' });
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (query.length < 10 || query.length > 5000) {
    return res.status(400).json({ message: 'Query must be between 10 and 5,000 characters.' });
  }

  const { transporter, config } = getTransporter();

  try {
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      replyTo: { name, address: email },
      subject: 'Queries from customer',
      text: [
        'A customer submitted a query from the Monk Hagen website.',
        '',
        `Name: ${name}`,
        `Email: ${email}`,
        '',
        'Query:',
        query
      ].join('\n')
    });
  } catch (error) {
    console.error('Contact email delivery failed:', error.code || 'SMTP_ERROR');
    const deliveryError = new Error('We could not send your query right now. Please try again later.');
    deliveryError.status = 502;
    throw deliveryError;
  }

  res.status(202).json({ message: 'Your query has been sent. We will get back to you soon.' });
});
