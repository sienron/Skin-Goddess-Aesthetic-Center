const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS trusted_login_devices (
        device_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_trusted_login_devices_user_expiry
      ON trusted_login_devices (user_id, expires_at)
    `);
    console.log('Trusted login device migration completed successfully.');
  } catch (error) {
    console.error('Trusted login device migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());