const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS reminder_email_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS reminder_email_1h_sent BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      UPDATE appointments
      SET reminder_email_24h_sent =
            appointment_date + appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '24 hours',
          reminder_email_1h_sent =
            appointment_date + appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '1 hour'
    `);
    console.log('Appointment email reminders migration completed successfully.');
  } catch (error) {
    console.error('Appointment email reminders migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
