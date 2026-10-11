const db = require('../db');

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS cash_closings (
          cash_closing_id BIGSERIAL PRIMARY KEY,
          business_date DATE NOT NULL UNIQUE,
          expected_amount NUMERIC(14, 2) NOT NULL CHECK (expected_amount >= 0),
          actual_amount NUMERIC(14, 2) NOT NULL CHECK (actual_amount >= 0),
          variance NUMERIC(15, 2) NOT NULL,
          closed_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (variance = actual_amount - expected_amount)
        );

        CREATE INDEX IF NOT EXISTS appointments_status_date_idx
          ON appointments (appointment_status, appointment_date);

        CREATE INDEX IF NOT EXISTS payments_type_status_created_at_idx
          ON payments (payment_type, status, created_at DESC);
      `);
    });
    console.log('Finance dashboard and cash-closing schema is ready.');
  } catch (error) {
    console.error('Finance dashboard and cash-closing migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
