const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const character of value.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret encoding.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function createTotpSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function codeForStep(secret, step) {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1000000).padStart(6, '0');
}

function matchTotpStep(secret, code, now = Date.now(), window = 1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  const supplied = Buffer.from(code);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const expected = Buffer.from(codeForStep(secret, step));
    if (crypto.timingSafeEqual(supplied, expected)) return step;
  }
  return null;
}

function createTotpUri(secret, account, issuer = 'Skin Goddess Aesthetic Center') {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params}`;
}

function getEncryptionKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error('MFA_ENCRYPTION_KEY must be configured to use privileged MFA.');
  }

  let key;
  if (/^[a-f\d]{64}$/i.test(configured)) {
    key = Buffer.from(configured, 'hex');
  } else {
    key = Buffer.from(configured, 'base64');
    if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== configured.replace(/=+$/, '')) {
      throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hexadecimal key.');
    }
  }
  if (key.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hexadecimal key.');
  }
  return key;
}

function validateEncryptionKey() {
  getEncryptionKey();
}

function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptTotpSecret({ ciphertext, iv, tag }) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function createRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => crypto.randomBytes(12).toString('hex').toUpperCase());
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
}

function createEnrollmentCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashEnrollmentCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = {
  createTotpSecret,
  codeForStep,
  matchTotpStep,
  createTotpUri,
  encryptTotpSecret,
  decryptTotpSecret,
  createRecoveryCodes,
  hashRecoveryCode,
  createEnrollmentCode,
  hashEnrollmentCode,
  validateEncryptionKey,
};
