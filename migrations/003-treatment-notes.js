// Persistent treatment notes for appointments.
const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS treatment_notes (
        note_id SERIAL PRIMARY KEY,
        appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(user_id),
        note_text TEXT NOT NULL DEFAULT '',
        color VARCHAR(20) NOT NULL DEFAULT '#FFF3B0',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS treatment_notes_appointment_id_idx ON treatment_notes (appointment_id)');
    console.log('Treatment notes migration completed successfully.');
  } catch (error) {
    console.error('Treatment notes migration stopped unexpectedly.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());