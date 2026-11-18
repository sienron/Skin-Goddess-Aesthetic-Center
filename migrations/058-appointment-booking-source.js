const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_source VARCHAR(20);
      ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_booking_source_check;
      ALTER TABLE appointments ADD CONSTRAINT appointments_booking_source_check
        CHECK (booking_source IS NULL OR booking_source IN ('walk_in', 'online'));
      UPDATE appointments a SET booking_source = 'online'
      WHERE a.booking_source IS NULL
        AND EXISTS (SELECT 1 FROM paymongo_checkout_sessions checkout
          WHERE checkout.appointment_id = a.appointment_id);
    `);
  });
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Appointment booking source tracking is ready.'))
    .catch((error) => {
      console.error('Appointment booking source migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
