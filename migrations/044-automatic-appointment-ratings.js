const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointment_ratings
        ADD COLUMN IF NOT EXISTS is_automatic BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('Automatic appointment ratings migration completed successfully.');
  } catch (error) {
    console.error('Automatic appointment ratings migration failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  migrate().finally(() => db.pool.end());
}

module.exports = { migrate };
