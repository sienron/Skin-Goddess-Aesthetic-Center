const { createHmac, timingSafeEqual } = require('crypto');

const PAYMONGO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function verifyPayMongoWebhookSignature(
  signatureHeader,
  rawBody,
  config,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof signatureHeader !== 'string' || !Buffer.isBuffer(rawBody)
    || !config || typeof config.webhookSecret !== 'string' || !config.webhookSecret
    || typeof config.isLive !== 'boolean') {
    return false;
  }

  const fields = {};
  for (const part of signatureHeader.split(',')) {
    const field = part.trim();
    const separator = field.indexOf('=');
    if (separator <= 0) return false;

    const name = field.slice(0, separator).trim();
    const value = field.slice(separator + 1).trim();
    if (!['t', 'te', 'li'].includes(name) || Object.hasOwn(fields, name)) return false;
    fields[name] = value;
  }

  if (!/^\d+$/.test(fields.t || '')) return false;
  const timestamp = Number(fields.t);
  if (!Number.isSafeInteger(timestamp)
    || !Number.isSafeInteger(nowSeconds)
    || Math.abs(nowSeconds - timestamp) > PAYMONGO_WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const suppliedSignature = fields[config.isLive ? 'li' : 'te'];
  if (typeof suppliedSignature !== 'string' || !/^[a-f\d]{64}$/i.test(suppliedSignature)) {
    return false;
  }

  const expectedSignature = createHmac('sha256', config.webhookSecret)
    .update(Buffer.concat([Buffer.from(`${fields.t}.`), rawBody]))
    .digest();
  const actualSignature = Buffer.from(suppliedSignature, 'hex');
  return actualSignature.length === expectedSignature.length
    && timingSafeEqual(actualSignature, expectedSignature);
}

module.exports = {
  PAYMONGO_WEBHOOK_TOLERANCE_SECONDS,
  verifyPayMongoWebhookSignature,
};
