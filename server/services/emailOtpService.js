const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { getTransporter } = require('../config/mailer');
const EMAIL = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').trim().toLowerCase();
const fault = (status, message) => Object.assign(new Error(message), { status });
function code() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
async function send(user, input, { database = pool, mailer = getTransporter } = {}) {
  const email = clean(input); if (!EMAIL.test(email) || email.length > 254) throw fault(400, 'Enter a valid email address.');
  const value = code();
  await database.query(`DELETE FROM email_verification_otps WHERE user_id=$1 AND email=$2 AND consumed_at IS NULL`, [user.id, email]);
  await database.query(`INSERT INTO email_verification_otps (user_id,email,code_hash,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '10 minutes')`, [user.id,email,hash(value)]);
  try { const { transporter, config } = mailer(); await transporter.sendMail({ from: config.from, to: email,
    subject: 'Your Monk Hagen email verification code', text: `Your Monk Hagen verification code is ${value}. It expires in 10 minutes. Do not share this code.` });
  } catch (error) { await database.query(`DELETE FROM email_verification_otps WHERE user_id=$1 AND email=$2 AND consumed_at IS NULL`, [user.id,email]); throw fault(503, 'We could not send the verification email. Please try again later.'); }
  return { email, expiresInSeconds: 600 };
}
async function verify(user, input, otp, { database = pool } = {}) {
  const email = clean(input); if (!EMAIL.test(email) || !/^\d{6}$/.test(String(otp || ''))) throw fault(400, 'Enter the email and its 6-digit verification code.');
  const client = await database.connect();
  try { await client.query('BEGIN'); const found = await client.query(`SELECT * FROM email_verification_otps WHERE user_id=$1 AND email=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[user.id,email]); const row=found.rows[0];
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= 5) throw fault(401, 'The verification code is incorrect or has expired.');
    if (!crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash(String(otp))))) { await client.query('UPDATE email_verification_otps SET attempts=attempts+1 WHERE id=$1',[row.id]); await client.query('COMMIT'); throw fault(401,'The verification code is incorrect or has expired.'); }
    await client.query('UPDATE email_verification_otps SET consumed_at=NOW() WHERE id=$1',[row.id]); await client.query('COMMIT'); return email;
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
}
module.exports = { send, verify };
