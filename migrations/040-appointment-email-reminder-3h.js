const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'appointments'
            AND column_name = 'reminder_email_1h_sent'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'appointments'
            AND column_name = 'reminder_email_3h_sent'
        ) THEN
          ALTER TABLE appointments
            RENAME COLUMN reminder_email_1h_sent TO reminder_email_3h_sent;
        ELSE
          ALTER TABLE appointments
            ADD COLUMN IF NOT EXISTS reminder_email_3h_sent BOOLEAN NOT NULL DEFAULT FALSE;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'appointments'
              AND column_name = 'reminder_email_1h_sent'
          ) THEN
            UPDATE appointments
            SET reminder_email_3h_sent = reminder_email_1h_sent
            WHERE reminder_email_1h_sent = TRUE;
          END IF;
        END IF;
      END $$;
    `);
    console.log('Three-hour appointment email reminder tracking is ready.');
  } catch (error) {
    console.error('Three-hour appointment email reminder migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
