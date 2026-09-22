// Phase A: database protections for appointment scheduling.
// Safe to run repeatedly with: npm run migrate
const db = require('../db');

const ACTIVE_STATUSES = "'pending', 'confirmed', 'completed'";

async function migrate() {
  try {
    try {
      await db.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
    } catch (error) {
      console.error('Migration stopped: PostgreSQL could not enable the btree_gist extension. Ask the database administrator to grant permission, then run the migration again.');
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS aesthetician_id INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS appointment_end_time TIME
    `);

    await db.query(`
      UPDATE appointments a
      SET appointment_end_time = a.appointment_time + (s.duration_minutes * INTERVAL '1 minute')
      FROM services s
      WHERE a.service_id = s.service_id
        AND a.appointment_end_time IS NULL
    `);

    const missingEndTimes = await db.query(`
      SELECT appointment_id
      FROM appointments
      WHERE appointment_end_time IS NULL
      LIMIT 10
    `);
    if (missingEndTimes.rows.length > 0) {
      console.error('Migration stopped: some appointments could not be backfilled with an end time. Check their service records before trying again.');
      console.error('Example appointment IDs:', missingEndTimes.rows.map((row) => row.appointment_id).join(', '));
      process.exitCode = 1;
      return;
    }

    await db.query('ALTER TABLE appointments ALTER COLUMN appointment_end_time SET NOT NULL');

    const activeWithoutAesthetician = await db.query(`
      SELECT appointment_id
      FROM appointments
      WHERE appointment_status IN (${ACTIVE_STATUSES})
        AND aesthetician_id IS NULL
      LIMIT 10
    `);
    if (activeWithoutAesthetician.rows.length > 0) {
      console.error('Migration stopped: active appointments without an aesthetician would bypass overlap protection. Assign an aesthetician before trying again.');
      console.error('Example appointment IDs:', activeWithoutAesthetician.rows.map((row) => row.appointment_id).join(', '));
      process.exitCode = 1;
      return;
    }

    const constraint = await db.query(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'appointments_no_overlap'
        AND conrelid = 'appointments'::regclass
    `);

    if (constraint.rows.length === 0) {
      try {
        await db.query(`
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_no_overlap
            EXCLUDE USING gist (
              aesthetician_id WITH =,
              tsrange(
                appointment_date + appointment_time,
                appointment_date + appointment_end_time
              ) WITH &&
            )
            WHERE (appointment_status IN (${ACTIVE_STATUSES}))
        `);
      } catch (error) {
        if (error.code === '23P01') {
          console.error('Migration stopped: existing active appointments overlap for the same aesthetician. Resolve the conflicting rows manually, then run the migration again.');
        } else {
          console.error('Migration stopped: the no-overlap constraint could not be created. No appointment data was deleted.');
        }
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
    }

    console.log('Appointment hardening migration completed successfully.');
  } catch (error) {
    console.error('Migration stopped unexpectedly. No data was deleted.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
