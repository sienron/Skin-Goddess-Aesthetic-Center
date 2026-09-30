// Base schema: users, otp_codes, password_reset_tokens, services, appointments.
// Supersedes archives/setup-db.js so a fresh database can be built by `npm run migrate` alone.
const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        date_of_birth DATE,
        gender VARCHAR(50),
        civil_status VARCHAR(50),
        contact_number VARCHAR(50),
        home_address TEXT,
        allergies TEXT,
        medical_conditions TEXT,
        email_verified BOOLEAN DEFAULT FALSE,
        role VARCHAR(50) DEFAULT 'client',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        otp_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        code VARCHAR(10) NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        reset_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS services (
        service_id SERIAL PRIMARY KEY,
        service_name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        duration_minutes INTEGER NOT NULL CONSTRAINT services_duration_minutes_positive CHECK (duration_minutes > 0),
        service_price DECIMAL(8, 2) NOT NULL CONSTRAINT services_service_price_positive CHECK (service_price > 0),
        reservation_fee DECIMAL(8, 2) NOT NULL CONSTRAINT services_reservation_fee_positive CHECK (reservation_fee > 0),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'services_duration_minutes_positive'
        ) THEN
          ALTER TABLE services ADD CONSTRAINT services_duration_minutes_positive CHECK (duration_minutes > 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'services_service_price_positive'
        ) THEN
          ALTER TABLE services ADD CONSTRAINT services_service_price_positive CHECK (service_price > 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'services_reservation_fee_positive'
        ) THEN
          ALTER TABLE services ADD CONSTRAINT services_reservation_fee_positive CHECK (reservation_fee > 0);
        END IF;
      END $$;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        appointment_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id),
        service_id INTEGER NOT NULL REFERENCES services(service_id),
        booked_service_price DECIMAL(8, 2) NOT NULL CONSTRAINT appointments_booked_service_price_positive CHECK (booked_service_price > 0),
        booked_reservation_fee DECIMAL(8, 2) NOT NULL CONSTRAINT appointments_booked_reservation_fee_positive CHECK (booked_reservation_fee > 0),
        payment_status VARCHAR(50) DEFAULT 'unpaid' NOT NULL CHECK (payment_status IN ('unpaid','pending', 'paid', 'refunded', 'failed')),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        appointment_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (appointment_status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Base schema migration completed successfully.');
  } catch (error) {
    console.error('Base schema migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
