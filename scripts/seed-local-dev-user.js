if (process.env.NODE_ENV === 'production') {
  console.error('Local development users cannot be created in production.');
  process.exit(1);
}

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const isValidPassword = require('../utils/password');

async function seedLocalDevUser() {
  const email = String(process.env.LOCAL_DEV_EMAIL || 'local-dev@skingoddess.test').trim().toLowerCase();
  const password = process.env.LOCAL_DEV_PASSWORD || `Local-${crypto.randomBytes(24).toString('base64url')}!`;
  if (!email || !isValidPassword(password)) {
    throw new Error('Provide a valid LOCAL_DEV_EMAIL and a password meeting the app password rules.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.query(`
    INSERT INTO users
      (email, password_hash, first_name, last_name, email_verified, role, status, mfa_enabled, dev_access_all)
    VALUES ($1, $2, 'Local', 'Developer', TRUE, 'admin', 'active', FALSE, TRUE)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      email_verified = TRUE,
      role = 'admin',
      status = 'active',
      mfa_enabled = FALSE,
      dev_access_all = TRUE
    RETURNING user_id
  `, [email, passwordHash]);

  console.log(`Local development admin ready (user ${result.rows[0].user_id}).`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log('Access-all and MFA bypass only apply when NODE_ENV is not production.');
}

seedLocalDevUser()
  .catch((error) => {
    console.error('Could not create the local development admin:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());