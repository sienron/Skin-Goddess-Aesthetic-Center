const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        type VARCHAR(80) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC)`);
    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS reminder_3h_sent BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_expiry_alerts (
        product_id INTEGER NOT NULL REFERENCES inventory_products(product_id) ON DELETE CASCADE,
        expiry_date DATE NOT NULL,
        alert_type VARCHAR(32) NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, expiry_date, alert_type)
      )
    `);
    console.log('Notifications migration completed successfully.');
  } catch (error) {
    console.error('Notifications migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());