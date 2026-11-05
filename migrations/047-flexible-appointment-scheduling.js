const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER
    `);
    await client.query(`
      UPDATE services
      SET buffer_minutes = 30
      WHERE buffer_minutes IS NULL
    `);
    await client.query(`
      ALTER TABLE services
        ALTER COLUMN buffer_minutes SET DEFAULT 30,
        ALTER COLUMN buffer_minutes SET NOT NULL
    `);

    await client.query(`
      ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS booked_duration_minutes INTEGER,
        ADD COLUMN IF NOT EXISTS booked_buffer_minutes INTEGER,
        ADD COLUMN IF NOT EXISTS scheduled_end_time TIME,
        ADD COLUMN IF NOT EXISTS adjusted_expected_end_time TIME
    `);
    await client.query(`
      UPDATE appointments a
      SET booked_duration_minutes = s.duration_minutes,
          booked_buffer_minutes = GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (a.appointment_end_time - a.appointment_time)) / 60)::integer
              - s.duration_minutes
          ),
          scheduled_end_time = a.appointment_end_time
      FROM services s
      WHERE s.service_id = a.service_id
        AND (
          a.booked_duration_minutes IS NULL
          OR a.booked_buffer_minutes IS NULL
          OR a.scheduled_end_time IS NULL
        )
    `);
    await client.query(`
      UPDATE appointments
      SET booked_duration_minutes = COALESCE(
            booked_duration_minutes,
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (appointment_end_time - appointment_time)) / 60)::integer)
          ),
          booked_buffer_minutes = COALESCE(booked_buffer_minutes, 0),
          scheduled_end_time = COALESCE(scheduled_end_time, appointment_end_time)
      WHERE booked_duration_minutes IS NULL
         OR booked_buffer_minutes IS NULL
         OR scheduled_end_time IS NULL
    `);
    await client.query(`
      ALTER TABLE appointments
        ALTER COLUMN booked_duration_minutes SET NOT NULL,
        ALTER COLUMN booked_buffer_minutes SET DEFAULT 30,
        ALTER COLUMN booked_buffer_minutes SET NOT NULL,
        ALTER COLUMN scheduled_end_time SET NOT NULL
    `);

    await client.query(`
      ALTER TABLE paymongo_checkout_sessions
        ADD COLUMN IF NOT EXISTS booked_duration_minutes INTEGER,
        ADD COLUMN IF NOT EXISTS booked_buffer_minutes INTEGER
    `);
    await client.query(`
      UPDATE paymongo_checkout_sessions checkout
      SET booked_duration_minutes = service.duration_minutes,
          booked_buffer_minutes = GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (checkout.appointment_end_time - checkout.appointment_time)) / 60)::integer
              - service.duration_minutes
          )
      FROM services service
      WHERE service.service_id = checkout.service_id
        AND (
          checkout.booked_duration_minutes IS NULL
          OR checkout.booked_buffer_minutes IS NULL
        )
    `);
    await client.query(`
      UPDATE paymongo_checkout_sessions
      SET booked_duration_minutes = COALESCE(
            booked_duration_minutes,
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (appointment_end_time - appointment_time)) / 60)::integer)
          ),
          booked_buffer_minutes = COALESCE(booked_buffer_minutes, 0)
      WHERE booked_duration_minutes IS NULL OR booked_buffer_minutes IS NULL
    `);
    await client.query(`
      ALTER TABLE paymongo_checkout_sessions
        ALTER COLUMN booked_duration_minutes SET NOT NULL,
        ALTER COLUMN booked_buffer_minutes SET NOT NULL
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'services_buffer_minutes_valid'
            AND conrelid = 'services'::regclass
        ) THEN
          ALTER TABLE services
            ADD CONSTRAINT services_buffer_minutes_valid
            CHECK (buffer_minutes BETWEEN 0 AND 1440);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'appointments_booked_duration_minutes_positive'
            AND conrelid = 'appointments'::regclass
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_booked_duration_minutes_positive
            CHECK (booked_duration_minutes > 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'appointments_booked_buffer_minutes_valid'
            AND conrelid = 'appointments'::regclass
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_booked_buffer_minutes_valid
            CHECK (booked_buffer_minutes BETWEEN 0 AND 1440);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'appointments_adjusted_expected_end_valid'
            AND conrelid = 'appointments'::regclass
        ) THEN
          ALTER TABLE appointments
            ADD CONSTRAINT appointments_adjusted_expected_end_valid
            CHECK (
              adjusted_expected_end_time IS NULL
              OR (
                adjusted_expected_end_time > appointment_time
                AND adjusted_expected_end_time >= appointment_end_time
              )
            );
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'checkout_booked_duration_minutes_positive'
            AND conrelid = 'paymongo_checkout_sessions'::regclass
        ) THEN
          ALTER TABLE paymongo_checkout_sessions
            ADD CONSTRAINT checkout_booked_duration_minutes_positive
            CHECK (booked_duration_minutes > 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'checkout_booked_buffer_minutes_valid'
            AND conrelid = 'paymongo_checkout_sessions'::regclass
        ) THEN
          ALTER TABLE paymongo_checkout_sessions
            ADD CONSTRAINT checkout_booked_buffer_minutes_valid
            CHECK (booked_buffer_minutes BETWEEN 0 AND 1440);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointment_end_time_adjustments (
        adjustment_id BIGSERIAL PRIMARY KEY,
        appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        administrator_id INTEGER NOT NULL REFERENCES users(user_id),
        previous_end_time TIME NOT NULL,
        new_end_time TIME NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS appointment_end_adjustments_history_idx
      ON appointment_end_time_adjustments (appointment_id, created_at DESC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointment_delay_notifications (
        source_appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        affected_appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
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
        last_notified_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_appointment_id, affected_appointment_id),
        CONSTRAINT appointment_delay_no_self_reference
          CHECK (source_appointment_id <> affected_appointment_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS appointments_staff_expected_end_idx
      ON appointments (aesthetician_id, appointment_date, appointment_time)
      WHERE appointment_status IN ('confirmed', 'in_progress', 'completed')
    `);
  });
}

async function down() {
  await db.transaction(async (client) => {
    await client.query('DROP TABLE IF EXISTS appointment_delay_notifications');
    await client.query('DROP TABLE IF EXISTS appointment_end_time_adjustments');
    await client.query('DROP INDEX IF EXISTS appointments_staff_expected_end_idx');
    await client.query(`
      ALTER TABLE paymongo_checkout_sessions
        DROP CONSTRAINT IF EXISTS checkout_booked_duration_minutes_positive,
        DROP CONSTRAINT IF EXISTS checkout_booked_buffer_minutes_valid,
        DROP COLUMN IF EXISTS booked_duration_minutes,
        DROP COLUMN IF EXISTS booked_buffer_minutes
    `);
    await client.query(`
      ALTER TABLE appointments
        DROP CONSTRAINT IF EXISTS appointments_booked_duration_minutes_positive,
        DROP CONSTRAINT IF EXISTS appointments_booked_buffer_minutes_valid,
        DROP CONSTRAINT IF EXISTS appointments_adjusted_expected_end_valid,
        DROP COLUMN IF EXISTS booked_duration_minutes,
        DROP COLUMN IF EXISTS booked_buffer_minutes,
        DROP COLUMN IF EXISTS scheduled_end_time,
        DROP COLUMN IF EXISTS adjusted_expected_end_time
    `);
    await client.query(`
      ALTER TABLE services
        DROP CONSTRAINT IF EXISTS services_buffer_minutes_valid,
        DROP COLUMN IF EXISTS buffer_minutes
    `);
  });
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Flexible appointment scheduling migration completed successfully.'))
    .catch((error) => {
      console.error('Flexible appointment scheduling migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate, down };
