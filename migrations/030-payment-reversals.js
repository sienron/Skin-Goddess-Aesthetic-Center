const db = require('../db');

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        ALTER TABLE payments
          DROP CONSTRAINT IF EXISTS payments_status_check;

        ALTER TABLE payments
          ADD CONSTRAINT payments_status_check
          CHECK (status IN ('posted', 'refunded', 'reversed'));

        CREATE TABLE IF NOT EXISTS payment_reversals (
          reversal_id SERIAL PRIMARY KEY,
          payment_id INT NOT NULL UNIQUE REFERENCES payments(payment_id) ON DELETE RESTRICT,
          reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
          reversed_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
          reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    });
    console.log('Payment reversal audit schema is ready.');
  } catch (error) {
    console.error('Payment reversal migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => db.pool.end());
