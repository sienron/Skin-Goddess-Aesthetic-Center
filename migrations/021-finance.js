const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id SERIAL PRIMARY KEY,
        appointment_id INT NULL REFERENCES appointments(appointment_id),
        payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('reservation', 'balance', 'product_sale')),
        amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
        method VARCHAR(20) NOT NULL CHECK (method IN ('paymongo', 'cash', 'gcash', 'card')),
        reference_no VARCHAR(100),
        note TEXT,
        recorded_by INT NULL REFERENCES users(user_id),
        status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'refunded')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS payments_one_reservation_per_appointment
        ON payments (appointment_id)
        WHERE payment_type = 'reservation' AND appointment_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS expenses (
        expense_id SERIAL PRIMARY KEY,
        expense_date DATE NOT NULL,
        category VARCHAR(40) NOT NULL CHECK (category IN (
          'Inventory & Supplies', 'Salaries & Commissions', 'Rent', 'Utilities',
          'Marketing', 'Equipment Maintenance', 'Other'
        )),
        description TEXT NOT NULL,
        amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
        supplier VARCHAR(150),
        reference_no VARCHAR(100),
        recorded_by INT REFERENCES users(user_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        voided_at TIMESTAMPTZ NULL,
        voided_by INT NULL REFERENCES users(user_id),
        void_reason TEXT NULL
      );

      CREATE INDEX IF NOT EXISTS payments_created_at_idx ON payments (created_at);
      CREATE INDEX IF NOT EXISTS payments_appointment_id_idx ON payments (appointment_id);
      CREATE INDEX IF NOT EXISTS expenses_expense_date_idx ON expenses (expense_date);

      INSERT INTO payments (appointment_id, payment_type, amount, method, reference_no, note, status, created_at)
      SELECT a.appointment_id, 'reservation', a.booked_reservation_fee,
             'paymongo', checkout.reference_number, 'Backfilled paid appointment', 'posted',
             COALESCE(checkout.created_at, a.created_at, NOW())
      FROM appointments a
      LEFT JOIN LATERAL (
        SELECT reference_number, created_at
        FROM paymongo_checkout_sessions
        WHERE appointment_id = a.appointment_id
        ORDER BY created_at
        LIMIT 1
      ) checkout ON TRUE
      WHERE a.payment_status = 'paid'
      ON CONFLICT (appointment_id)
        WHERE payment_type = 'reservation' AND appointment_id IS NOT NULL
      DO NOTHING;
    `);

    console.log('Finance tables and reservation payment backfill are ready.');
  } catch (error) {
    console.error('Finance migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());