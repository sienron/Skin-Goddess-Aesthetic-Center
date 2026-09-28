// Seeds the development/staging Nail Tech account, assigned to the nail-focused
// service categories (see utils/staffRoles.js). Reuses SEED_AESTHETICIAN_PASSWORD
// so no new secret is needed; the password should be rotated by the user later.
const bcrypt = require('bcryptjs');
const db = require('../db');

const NAIL_TECHS = [
  { email: 'skingoddess.nailtech@gmail.com', firstName: 'Nail', lastName: 'Tech' },
];

async function seedNailTechs() {
  const password = process.env.SEED_AESTHETICIAN_PASSWORD;
  if (!password) {
    console.error('Seed stopped: set SEED_AESTHETICIAN_PASSWORD before running the migration.');
    process.exitCode = 1;
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    for (const nailTech of NAIL_TECHS) {
      const existing = await db.query(
        'SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)',
        [nailTech.email]
      );

      if (existing.rows.length > 0) {
        console.log(`Skipped ${nailTech.email}: a user with this email already exists.`);
        continue;
      }

      await db.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, email_verified, role)
        VALUES ($1, $2, $3, $4, TRUE, 'nail_tech')
      `, [
        nailTech.email,
        passwordHash,
        nailTech.firstName,
        nailTech.lastName,
      ]);
      console.log(`Seeded nail tech: ${nailTech.email}`);
    }
  } catch (error) {
    console.error('Nail tech seed stopped unexpectedly.');
    console.error(error.message);
    process.exitCode = 1;
  }
}

seedNailTechs().finally(() => process.exit());
