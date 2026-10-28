const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS customer_first_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS customer_last_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS customer_email VARCHAR(254),
        ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50)
    `);
    await db.query(`
      ALTER TABLE paymongo_checkout_sessions
        ADD COLUMN IF NOT EXISTS customer_first_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS customer_last_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS customer_email VARCHAR(254),
        ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50)
    `);
    console.log('Appointment customer details migration completed successfully.');
  } catch (error) {
    console.error('Appointment customer details migration failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  migrate().finally(() => db.pool.end());
}

module.exports = { migrate };
