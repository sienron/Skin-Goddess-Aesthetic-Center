const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS paymongo_checkout_sessions (
        reference_number VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id),
        service_id INTEGER NOT NULL REFERENCES services(service_id),
        service_name TEXT NOT NULL,
        service_price DECIMAL(10, 2) NOT NULL CHECK (service_price >= 0),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        appointment_end_time TIME NOT NULL,
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        currency VARCHAR(3) NOT NULL CHECK (currency = 'PHP'),
        status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'consumed')),
        livemode BOOLEAN NOT NULL,
        checkout_session_id VARCHAR(100) UNIQUE,
        appointment_id INTEGER UNIQUE REFERENCES appointments(appointment_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS paymongo_checkout_user_idx ON paymongo_checkout_sessions (user_id, created_at DESC)`);
    console.log('PayMongo checkout migration completed successfully.');
  } catch (error) {
    console.error('PayMongo checkout migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());