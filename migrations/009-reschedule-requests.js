const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS reschedule_request_status VARCHAR(20),
        ADD COLUMN IF NOT EXISTS reschedule_requested_date DATE,
        ADD COLUMN IF NOT EXISTS reschedule_requested_time TIME,
        ADD COLUMN IF NOT EXISTS reschedule_requested_end_time TIME,
        ADD COLUMN IF NOT EXISTS reschedule_reason VARCHAR(255),
        ADD COLUMN IF NOT EXISTS reschedule_description TEXT,
        ADD COLUMN IF NOT EXISTS reschedule_requested_by INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reschedule_reviewed_by INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS reschedule_reviewed_at TIMESTAMPTZ
    `);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'appointments_reschedule_request_status_check'
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_reschedule_request_status_check
            CHECK (reschedule_request_status IS NULL OR reschedule_request_status IN ('pending', 'approved', 'rejected'));
        END IF;
      END $$;
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS appointments_reschedule_request_idx ON appointments (reschedule_request_status) WHERE reschedule_request_status = 'pending'`);
    console.log('Reschedule request migration completed successfully.');
  } catch (error) {
    console.error('Reschedule request migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
