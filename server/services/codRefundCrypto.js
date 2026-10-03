const crypto = require('node:crypto');

const KEY_VERSION = 1;
const AAD = Buffer.from('monkhagen:cod-refund:v1', 'utf8');

function configurationError() {
  return Object.assign(new Error('COD refund encryption is not configured.'), {
    status: 503, code: 'COD_REFUND_ENCRYPTION_UNAVAILABLE'
  });
}

function encryptionKey(environment = process.env) {
  const encoded = environment.COD_REFUND_ENCRYPTION_KEY;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded.trim())) throw configurationError();
  const key = Buffer.from(encoded.trim(), 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded.trim()) throw configurationError();
  return key;
}

function encrypt(value, environment = process.env) {
  const key = encryptionKey(environment);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${KEY_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decrypt(payload, environment = process.env) {
  if (typeof payload !== 'string') throw configurationError();
  const [version, ivText, tagText, ciphertextText, extra] = payload.split(':');
  if (version !== `v${KEY_VERSION}` || extra !== undefined || !ivText || !tagText || !ciphertextText) {
    throw Object.assign(new Error('Encrypted refund details could not be read.'), { status: 409, code: 'COD_REFUND_DECRYPTION_FAILED' });
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(environment), Buffer.from(ivText, 'base64url'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error.code === 'COD_REFUND_ENCRYPTION_UNAVAILABLE') throw error;
    throw Object.assign(new Error('Encrypted refund details could not be read.'), { status: 409, code: 'COD_REFUND_DECRYPTION_FAILED' });
  }
}

function maskAccount(value) { return `${'•'.repeat(8)}${String(value).slice(-4)}`; }
function maskUpi(value) {
  const [handle, provider] = String(value).split('@');
  const visible = handle.slice(0, Math.min(2, handle.length));
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, handle.length - visible.length)))}@${provider}`;
}

module.exports = { KEY_VERSION, encryptionKey, encrypt, decrypt, maskAccount, maskUpi };
