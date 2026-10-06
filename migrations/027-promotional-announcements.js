const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS promotional_announcements (
        announcement_id BIGSERIAL PRIMARY KEY,
        type VARCHAR(24) NOT NULL CHECK (type IN ('promo', 'deal', 'event', 'announcement')),
        title VARCHAR(160) NOT NULL,
        message TEXT NOT NULL,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS promotional_announcements_active_idx
      ON promotional_announcements (starts_at, ends_at)
      WHERE is_published = TRUE
    `);
    console.log('Promotional announcements table is ready.');
  } catch (error) {
    console.error('Promotional announcements migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
