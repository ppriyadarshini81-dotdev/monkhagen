const nodemailer = require('nodemailer');

let transporter;

function getMailConfig() {
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE.toLowerCase() === 'true'
    : port === 465;

  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const error = new Error('Email service is not configured.');
    error.status = 503;
    throw error;
  }

  return {
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.CONTACT_EMAIL || 'official@monkhagen.in'
  };
}

function getTransporter() {
  const config = getMailConfig();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      // Port 587 must upgrade with STARTTLS before authentication; port 465
      // already uses implicit TLS. Never accept an unverified certificate.
      requireTLS: !config.secure,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    });
  }
  return { transporter, config };
}

module.exports = { getTransporter };
