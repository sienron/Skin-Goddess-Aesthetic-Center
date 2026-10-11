require('dotenv').config();

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const databaseHost = String(process.env.DB_HOST || '').trim().toLowerCase();

if (process.env.NODE_ENV === 'production') {
  console.error('Role test accounts cannot be created in production.');
  process.exit(1);
}

if (!LOCAL_DATABASE_HOSTS.has(databaseHost)) {
  console.error('Role test accounts require a local database host (localhost, 127.0.0.1, or ::1).');
  process.exit(1);
}

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const isValidPassword = require('../utils/password');

const TEST_ACCOUNTS = [
  { email: 'mock.client@skingoddess.test', firstName: 'Mock', lastName: 'Client', role: 'client' },
  { email: 'mock.finance@skingoddess.test', firstName: 'Mock', lastName: 'Finance', role: 'finance_officer' },
  { email: 'mock.inventory@skingoddess.test', firstName: 'Mock', lastName: 'Inventory', role: 'inventory_officer' },
];

function createPassword() {
  return process.env.MOCK_TEST_PASSWORD || `${crypto.randomBytes(24).toString('base64url')}!A1`;
}

async function seedRoleTestAccounts() {
  const configuredPassword = process.env.MOCK_TEST_PASSWORD;
  if (configuredPassword && !isValidPassword(configuredPassword)) {
    throw new Error('MOCK_TEST_PASSWORD must meet the application password rules.');
  }

  for (const account of TEST_ACCOUNTS) {
    const existing = await db.query(
      'SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)',
      [account.email],
    );
    if (existing.rows.length > 0) {
      console.log(`Skipped ${account.email}: an account with this email already exists.`);
      continue;
    }

    const password = createPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(`
      INSERT INTO users
        (email, password_hash, first_name, last_name, email_verified, role, status, mfa_enabled, dev_access_all)
      VALUES ($1, $2, $3, $4, TRUE, $5, 'active', FALSE, FALSE)
      RETURNING user_id
    `, [account.email, passwordHash, account.firstName, account.lastName, account.role]);

    console.log(`Created ${account.role} test account (user ${result.rows[0].user_id}).`);
    console.log(`Email: ${account.email}`);
    console.log(`Password: ${password}`);
  }
}

seedRoleTestAccounts()
  .catch((error) => {
    console.error('Could not create role test accounts:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
