const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      DO $$
      DECLARE constraint_record RECORD;
      BEGIN
        UPDATE appointments
        SET appointment_status = CASE
          WHEN payment_status = 'paid' THEN 'confirmed'
          ELSE 'cancelled'
        END
        WHERE appointment_status = 'pending';

        FOR constraint_record IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'appointments'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%appointment_status%'
        LOOP
          EXECUTE format('ALTER TABLE appointments DROP CONSTRAINT %I', constraint_record.conname);
        END LOOP;

        ALTER TABLE appointments
          ALTER COLUMN appointment_status SET DEFAULT 'confirmed';

        ALTER TABLE appointments
          ADD CONSTRAINT appointments_appointment_status_check
          CHECK (appointment_status IN ('confirmed', 'completed', 'cancelled', 'no_show'));
      END $$;
    `);
    console.log('Confirmed appointment status migration completed successfully.');
  } catch (error) {
    console.error('Confirmed appointment status migration failed.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());