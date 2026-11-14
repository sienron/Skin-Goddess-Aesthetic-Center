// Seeds a second local development aesthetician account. Reuses
// SEED_AESTHETICIAN_PASSWORD so no new secret is needed.
require('dotenv').config();

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const databaseHost = String(process.env.DB_HOST || '').trim().toLowerCase();

if (process.env.NODE_ENV === 'production' || !LOCAL_DATABASE_HOSTS.has(databaseHost)) {
  console.log('Skipped development aesthetician seed outside a local environment.');
  process.exit(0);
}

const bcrypt = require('bcryptjs');
const db = require('../db');

const AESTHETICIANS = [
  { email: 'demo.aesthetician2@skingoddess.test', firstName: 'Demo', lastName: 'Aesthetician' },
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
