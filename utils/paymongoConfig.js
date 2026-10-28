function getPayMongoConfig(env = process.env) {
  const isLive = env.NODE_ENV === 'production';
  const secretKey = isLive
    ? (env.PAYMONGO_LIVE_SECRET_KEY || env.PAYMONGO_SK)
    : (env.PAYMONGO_TEST_SECRET_KEY || env.PAYMONGO_SK);
  const webhookSecret = isLive
    ? env.PAYMONGO_LIVE_WEBHOOK_SECRET
    : env.PAYMONGO_TEST_WEBHOOK_SECRET;
  const keyPrefix = isLive ? 'sk_live_' : 'sk_test_';

  if (!secretKey || !secretKey.startsWith(keyPrefix) || !webhookSecret) return null;

  return { mode: isLive ? 'live' : 'test', isLive, secretKey, webhookSecret };
}

module.exports = { getPayMongoConfig };
