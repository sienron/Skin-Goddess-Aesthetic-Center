const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE appointments
        DROP CONSTRAINT IF EXISTS appointments_appointment_status_check,
        ADD CONSTRAINT appointments_appointment_status_check
        CHECK (appointment_status IN (
          'pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
        ))
    `);
  });
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Appointment in-progress status is enabled.'))
    .catch((error) => {
      console.error('Appointment status constraint migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
