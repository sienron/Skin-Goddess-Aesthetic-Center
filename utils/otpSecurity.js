const crypto = require('node:crypto');

const EPHEMERAL_OTP_HASH_KEY = crypto.randomBytes(32);

function getOtpHashKey() {
  return process.env.SESSION_SECRET || EPHEMERAL_OTP_HASH_KEY;
}

function hashOtpCode(code, userId, purpose) {
  return crypto.createHmac('sha256', getOtpHashKey())
    .update(`${userId}\0${purpose}\0${code}`)
    .digest('hex');
}

function verifyOtpCode(code, codeHash, userId, purpose) {
  if (typeof codeHash !== 'string' || !/^[a-f0-9]{64}$/i.test(codeHash)) return false;
  const expected = Buffer.from(hashOtpCode(code, userId, purpose), 'hex');
  const actual = Buffer.from(codeHash, 'hex');
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashOtpCode, verifyOtpCode };
