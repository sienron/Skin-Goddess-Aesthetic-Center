// Enables automatic PayMongo refunds: track the real payment id per checkout
// session and allow the status column to record a completed refund.
const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE paymongo_checkout_sessions
        ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ
    `);

    await db.query(`ALTER TABLE paymongo_checkout_sessions DROP CONSTRAINT IF EXISTS paymongo_checkout_sessions_status_check`);
    await db.query(`
      ALTER TABLE paymongo_checkout_sessions
        ADD CONSTRAINT paymongo_checkout_sessions_status_check
        CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'consumed', 'refunded'))
    `);

    console.log('Payment refunds migration completed successfully.');
  } catch (error) {
    console.error('Payment refunds migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
