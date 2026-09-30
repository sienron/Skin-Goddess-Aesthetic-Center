const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS appointment_ratings (
        rating_id SERIAL PRIMARY KEY,
        appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES users(user_id),
        staff_id INTEGER NOT NULL REFERENCES users(user_id),
        service_id INTEGER NOT NULL REFERENCES services(service_id),
        rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT CHECK (char_length(comment) <= 1000),
        is_public BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS appointment_ratings_staff_idx ON appointment_ratings (staff_id)`);
    console.log('Appointment ratings migration completed successfully.');
  } catch (error) {
    console.error('Appointment ratings migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
