// Add the no_show appointment status without changing existing appointment data.
const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = 'appointments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%appointment_status%';

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE appointments DROP CONSTRAINT %I', constraint_name);
        END IF;

        ALTER TABLE appointments
          ADD CONSTRAINT appointments_appointment_status_check
          CHECK (appointment_status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));
      END $$;
    `);
    console.log('no_show appointment status migration completed successfully.');
  } catch (error) {
    console.error('no_show appointment status migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
