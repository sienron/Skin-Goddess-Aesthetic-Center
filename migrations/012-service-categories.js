const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS category VARCHAR(255) NOT NULL DEFAULT 'General';
    `);
    await db.query(`
      ALTER TABLE services
        ALTER COLUMN category DROP DEFAULT;
    `);
    console.log('Service categories migration completed successfully.');
  } catch (error) {
    console.error('Service categories migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
