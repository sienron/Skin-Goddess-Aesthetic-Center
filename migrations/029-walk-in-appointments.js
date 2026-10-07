const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE appointments
        ALTER COLUMN user_id DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(200)
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'appointments_client_identity_check'
            AND conrelid = 'appointments'::regclass
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_client_identity_check
            CHECK (
              (user_id IS NOT NULL AND walk_in_name IS NULL)
              OR (user_id IS NULL AND NULLIF(BTRIM(walk_in_name), '') IS NOT NULL)
            );
        END IF;
      END $$;
    `);

    console.log('Walk-in appointment support migration completed successfully.');
  } catch (error) {
    console.error('Walk-in appointment support migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
