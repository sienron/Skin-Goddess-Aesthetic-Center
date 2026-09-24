// Add the user-management fields to databases created before the admin page
// introduced account status and update timestamps.
const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
    `);

    console.log('User management columns migration completed successfully.');
  } catch (error) {
    console.error('User management columns migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());