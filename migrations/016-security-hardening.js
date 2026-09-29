const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire)');
    await db.query(`
      ALTER TABLE otp_codes
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS pending_email_changes (
        change_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        new_email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE pending_email_changes
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0
    `);
    console.log('Security hardening migration completed successfully.');
  } catch (error) {
    console.error('Security hardening migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());