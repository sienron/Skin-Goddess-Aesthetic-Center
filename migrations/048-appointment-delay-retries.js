const db = require('../db');

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'appointments'
              AND column_name = 'booked_duration_is_estimated'
          ) THEN
            ALTER TABLE appointments
              ADD COLUMN booked_duration_is_estimated BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
        END $$;
        ALTER TABLE appointments
          ALTER COLUMN booked_duration_is_estimated SET DEFAULT FALSE
      `);

      const ledgerState = await client.query(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'appointment_delay_notifications'
            AND column_name = 'source_appointment_ids'
        ) AS already_migrated
      `);
      if (ledgerState.rows[0].already_migrated) return;

      await client.query(`
        ALTER TABLE appointment_delay_notifications
          RENAME TO appointment_delay_notifications_by_source
      `);
      await client.query(`
        ALTER INDEX appointment_delay_notifications_pkey
          RENAME TO appointment_delay_notifications_by_source_pkey
      `);
      await client.query(`
        CREATE TABLE appointment_delay_notifications (
          affected_appointment_id INTEGER PRIMARY KEY
            REFERENCES appointments(appointment_id) ON DELETE CASCADE,
          source_appointment_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::integer[],
          notification_id BIGINT REFERENCES notifications(notification_id) ON DELETE SET NULL,
          expected_start_time TIME NOT NULL,
          delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
          is_delayed BOOLEAN NOT NULL DEFAULT TRUE,
          notified_start_time TIME,
          notified_delay_minutes INTEGER,
          delivery_status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (delivery_status IN ('pending', 'sent', 'failed')),
          email_status VARCHAR(16) NOT NULL DEFAULT 'pending'
            CHECK (email_status IN ('pending', 'sent', 'failed', 'not_requested')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          claimed_at TIMESTAMPTZ,
          last_error TEXT,
          last_notified_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        INSERT INTO appointment_delay_notifications (
          affected_appointment_id, source_appointment_ids, notification_id,
          expected_start_time, delay_minutes, is_delayed,
          notified_start_time, notified_delay_minutes,
          delivery_status, email_status, next_attempt_at,
          last_notified_at, updated_at
        )
        SELECT DISTINCT ON (legacy.affected_appointment_id)
          legacy.affected_appointment_id,
          sources.source_appointment_ids,
          legacy.notification_id,
          legacy.expected_start_time,
          legacy.delay_minutes,
          legacy.is_delayed,
          legacy.notified_start_time,
          legacy.notified_delay_minutes,
          CASE
            WHEN legacy.delivery_status = 'sent'
              AND legacy.email_status <> 'failed' THEN 'sent'
            ELSE 'pending'
          END,
          legacy.email_status,
          NOW(),
          legacy.last_notified_at,
          NOW()
        FROM appointment_delay_notifications_by_source legacy
        CROSS JOIN LATERAL (
          SELECT ARRAY_AGG(DISTINCT source_appointment_id) AS source_appointment_ids
          FROM appointment_delay_notifications_by_source sources
          WHERE sources.affected_appointment_id = legacy.affected_appointment_id
        ) sources
        ORDER BY legacy.affected_appointment_id, legacy.updated_at DESC,
                 legacy.source_appointment_id DESC
      `);
      await client.query(`
        CREATE INDEX appointment_delay_notifications_retry_due_idx
        ON appointment_delay_notifications (next_attempt_at, affected_appointment_id)
        WHERE attempt_count < 5
          AND (delivery_status IN ('pending', 'failed') OR email_status = 'failed')
      `);
    });

    console.log('Appointment delay retry migration completed successfully.');
  } catch (error) {
    console.error('Appointment delay retry migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

async function rollback() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        INSERT INTO appointment_delay_notifications_by_source (
          source_appointment_id, affected_appointment_id, notification_id,
          expected_start_time, delay_minutes, is_delayed,
          notified_start_time, notified_delay_minutes,
          delivery_status, email_status, last_notified_at, updated_at
        )
        SELECT source.source_appointment_id, ledger.affected_appointment_id,
               ledger.notification_id, ledger.expected_start_time,
               ledger.delay_minutes, ledger.is_delayed,
               ledger.notified_start_time, ledger.notified_delay_minutes,
               ledger.delivery_status, ledger.email_status,
               ledger.last_notified_at, ledger.updated_at
        FROM appointment_delay_notifications ledger
        CROSS JOIN LATERAL UNNEST(ledger.source_appointment_ids) source(source_appointment_id)
        ON CONFLICT (source_appointment_id, affected_appointment_id) DO UPDATE
        SET notification_id = EXCLUDED.notification_id,
            expected_start_time = EXCLUDED.expected_start_time,
            delay_minutes = EXCLUDED.delay_minutes,
            is_delayed = EXCLUDED.is_delayed,
            notified_start_time = EXCLUDED.notified_start_time,
            notified_delay_minutes = EXCLUDED.notified_delay_minutes,
            delivery_status = EXCLUDED.delivery_status,
            email_status = EXCLUDED.email_status,
            last_notified_at = EXCLUDED.last_notified_at,
            updated_at = EXCLUDED.updated_at
      `);
      await client.query('DROP TABLE appointment_delay_notifications');
      await client.query(`
        ALTER TABLE appointment_delay_notifications_by_source
          RENAME TO appointment_delay_notifications
      `);
      await client.query(`
        ALTER INDEX appointment_delay_notifications_by_source_pkey
          RENAME TO appointment_delay_notifications_pkey
      `);
      await client.query(`
        ALTER TABLE appointments
          DROP COLUMN IF EXISTS booked_duration_is_estimated
      `);
    });

    console.log('Appointment delay retry migration rollback completed successfully.');
  } catch (error) {
    console.error('Appointment delay retry migration rollback failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

if (process.argv.includes('--down')) rollback();
else migrate();
