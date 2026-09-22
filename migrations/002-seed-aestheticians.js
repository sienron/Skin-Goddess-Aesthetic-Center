// Phase A: development/staging aestheticians for appointment assignment.
// The password is never hard-coded; set SEED_AESTHETICIAN_PASSWORD in .env.
const bcrypt = require('bcryptjs');
const db = require('../db');

const AESTHETICIANS = [
  { email: 'geraselragudo123@gmail.com', firstName: 'Gerase', lastName: 'Ragudo' },
  { email: 'loidadeguzman123@gmail.com', firstName: 'Loida', lastName: 'De Guzman' },
];

async function seedAestheticians() {
  const password = process.env.SEED_AESTHETICIAN_PASSWORD;
  if (!password) {
    console.error('Seed stopped: set SEED_AESTHETICIAN_PASSWORD before running the migration.');
    process.exitCode = 1;
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    for (const aesthetician of AESTHETICIANS) {
      const existing = await db.query(
        'SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)',
        [aesthetician.email]
      );

      if (existing.rows.length > 0) {
        console.log(`Skipped ${aesthetician.email}: a user with this email already exists.`);
        continue;
      }

      await db.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, email_verified, role)
        VALUES ($1, $2, $3, $4, TRUE, 'aesthetician')
      `, [
        aesthetician.email,
        passwordHash,
        aesthetician.firstName,
        aesthetician.lastName,
      ]);
      console.log(`Seeded aesthetician: ${aesthetician.email}`);
    }
  } catch (error) {
    console.error('Aesthetician seed stopped unexpectedly.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

seedAestheticians().finally(() => process.exit());
