const VALID_NODE_ENVIRONMENTS = new Set(['development', 'production']);

function assertValidRuntimeSecurityConfig(env = process.env) {
  if (!VALID_NODE_ENVIRONMENTS.has(env.NODE_ENV)) {
    throw new Error('NODE_ENV must be explicitly set to development or production.');
  }

  if (env.NODE_ENV === 'production') {
    if (typeof env.SESSION_SECRET !== 'string' || !env.SESSION_SECRET.trim()) {
      throw new Error('SESSION_SECRET must be configured in production.');
    }
    if (Buffer.byteLength(env.SESSION_SECRET, 'utf8') < 32) {
      throw new Error('SESSION_SECRET must contain at least 32 bytes in production.');
    }
    if (typeof env.MFA_ENCRYPTION_KEY !== 'string' || !env.MFA_ENCRYPTION_KEY.trim()) {
      throw new Error('MFA_ENCRYPTION_KEY must be configured in production.');
    }
  }
}

module.exports = { assertValidRuntimeSecurityConfig };
