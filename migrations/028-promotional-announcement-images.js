const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE promotional_announcements
      ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''
    `);
    console.log('Promotional announcement images are ready.');
  } catch (error) {
    console.error('Promotional announcement image migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
