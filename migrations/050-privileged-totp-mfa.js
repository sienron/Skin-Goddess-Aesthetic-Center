const db = require('../db');

async function migrate() {
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS totp_secret_ciphertext TEXT,
      ADD COLUMN IF NOT EXISTS totp_secret_iv TEXT,
      ADD COLUMN IF NOT EXISTS totp_secret_tag TEXT,
      ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS privileged_mfa_enrollment_codes (
      enrollment_code_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      code_hash CHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      expired_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS privileged_mfa_enrollment_codes_user_idx
      ON privileged_mfa_enrollment_codes (user_id, created_at DESC)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS privileged_mfa_pending_enrollments (
      user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      secret_ciphertext TEXT NOT NULL,
      secret_iv TEXT NOT NULL,
      secret_tag TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS privileged_mfa_recovery_codes (
      recovery_code_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      code_hash CHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ,
      UNIQUE (user_id, code_hash)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS privileged_mfa_recovery_codes_user_idx
      ON privileged_mfa_recovery_codes (user_id, used_at)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS privileged_mfa_audit (
      audit_id BIGSERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      event_type VARCHAR(64) NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS privileged_mfa_audit_user_time_idx
      ON privileged_mfa_audit (user_id, occurred_at DESC)
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Privileged TOTP MFA schema is ready.'))
    .catch((error) => {
      console.error('Privileged TOTP MFA migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
