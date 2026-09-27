const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inquiries (
        inquiry_id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL,
        phone VARCHAR(50),
        inquiry_type VARCHAR(20) NOT NULL CHECK (inquiry_type IN ('booking', 'services', 'feedback', 'other')),
        message TEXT NOT NULL,
        admin_reply TEXT,
        replied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries (created_at DESC)`);
    console.log('Inquiries migration completed successfully.');
  } catch (error) {
    console.error('Inquiries migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());