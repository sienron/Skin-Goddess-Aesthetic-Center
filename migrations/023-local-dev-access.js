const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS dev_access_all BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('Local development account controls are ready.');
  } catch (error) {
    console.error('Local development access migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());