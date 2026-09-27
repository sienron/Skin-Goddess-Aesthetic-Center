const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS cancellation_request_status VARCHAR(20),
        ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(255),
        ADD COLUMN IF NOT EXISTS cancellation_description TEXT,
        ADD COLUMN IF NOT EXISTS cancellation_requested_by INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS cancellation_reviewed_by INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS cancellation_reviewed_at TIMESTAMPTZ
    `);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cancellation_request_status_check'
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_cancellation_request_status_check
            CHECK (cancellation_request_status IS NULL OR cancellation_request_status IN ('pending', 'approved', 'rejected'));
        END IF;
      END $$;
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS appointments_cancellation_request_idx ON appointments (cancellation_request_status) WHERE cancellation_request_status = 'pending'`);
    console.log('Cancellation request migration completed successfully.');
  } catch (error) {
    console.error('Cancellation request migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
