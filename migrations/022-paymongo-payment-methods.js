const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE paymongo_checkout_sessions
        ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

      ALTER TABLE payments
        DROP CONSTRAINT IF EXISTS payments_method_check;

      ALTER TABLE payments
        ADD CONSTRAINT payments_method_check
        CHECK (method IN ('paymongo', 'cash', 'gcash', 'maya', 'card'));

      ALTER TABLE paymongo_checkout_sessions
        DROP CONSTRAINT IF EXISTS paymongo_checkout_sessions_payment_method_check;

      ALTER TABLE paymongo_checkout_sessions
        ADD CONSTRAINT paymongo_checkout_sessions_payment_method_check
        CHECK (payment_method IS NULL OR payment_method IN ('paymongo', 'gcash', 'maya', 'card'));
    `);
    console.log('PayMongo payment-method tracking is ready.');
  } catch (error) {
    console.error('PayMongo payment-method migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());