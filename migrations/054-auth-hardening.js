const db = require('../db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      registration_id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      code_hash VARCHAR(64) NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      sent_count INTEGER NOT NULL DEFAULT 1 CHECK (sent_count BETWEEN 1 AND 5),
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS pending_registrations_expiry_idx
    ON pending_registrations (expires_at)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS login_failures (
      user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      limiter_key VARCHAR(64) NOT NULL,
      client_key CHAR(64) NOT NULL,
      total_hits INTEGER NOT NULL CHECK (total_hits >= 0),
      reset_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (limiter_key, client_key)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS rate_limit_counters_reset_idx
    ON rate_limit_counters (reset_at)
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Authentication hardening migration completed.'))
    .catch((error) => {
      console.error('Authentication hardening migration failed.', error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
