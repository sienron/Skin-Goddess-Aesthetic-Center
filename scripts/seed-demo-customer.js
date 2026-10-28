const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { createSecureCredentialFile } = require('../utils/secureCredentialFile');
const {
  DEMO_CUSTOMER_EMAIL,
  assertValidDemoCustomerConfiguration,
} = require('../utils/demoMode');
const {
  assertConnectedDemoDatabaseTarget,
  assertDemoDatabaseTargetConfigured,
} = require('../utils/demoDatabaseTarget');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const OPERATION_CONFIRMATIONS = {
  create: 'CREATE_DEMO_CUSTOMER_IN_SHARED_DATABASE',
  disable: 'SUSPEND_DEMO_CUSTOMER_IN_SHARED_DATABASE',
  retire: 'RETIRE_DEMO_CUSTOMER_AND_APPOINTMENTS',
};

function createPassword() {
  return `Dmo-${crypto.randomBytes(32).toString('base64url')}!`;
}

function assertCredentialFileIsOutsideRepository(filePath) {
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(REPOSITORY_ROOT, resolvedPath);
  if (!path.isAbsolute(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)) {
    throw new Error('DEMO_CUSTOMER_CREDENTIAL_FILE must be outside the repository.');
  }
  return resolvedPath;
}

function assertOperationConfirmation(operation) {
  if (process.env.DEMO_CUSTOMER_SETUP_CONFIRM !== OPERATION_CONFIRMATIONS[operation]) {
    throw new Error(`Set DEMO_CUSTOMER_SETUP_CONFIRM=${OPERATION_CONFIRMATIONS[operation]} to confirm this operation.`);
  }
  assertDemoDatabaseTargetConfigured();
}

async function createDemoCustomer(credentialFile) {
  assertValidDemoCustomerConfiguration();
  if (process.env.DEMO_CUSTOMER_MFA_BYPASS !== 'true') {
    throw new Error('Enable DEMO_CUSTOMER_MFA_BYPASS explicitly before creating the survey account.');
  }
  assertOperationConfirmation('create');
  const filePath = assertCredentialFileIsOutsideRepository(credentialFile);
  const customerPassword = createPassword();
  const customerPasswordHash = await bcrypt.hash(customerPassword, 12);
  let credentialFileCreated = false;
  let transactionStarted = false;
  let commitAttempted = false;
  let client;

  try {
    client = await db.pool.connect();
    await assertConnectedDemoDatabaseTarget(client);
    await client.query('BEGIN');
    transactionStarted = true;

    const existing = await client.query(
      'SELECT email FROM users WHERE LOWER(email) = $1 FOR UPDATE',
      [DEMO_CUSTOMER_EMAIL]
    );
    if (existing.rows.length) {
      throw new Error('The demo customer account already exists; refusing to overwrite it.');
    }

    const services = await client.query(`
      SELECT service_id, service_price, reservation_fee, duration_minutes
      FROM services
      WHERE is_active IS DISTINCT FROM FALSE
      ORDER BY service_id
      LIMIT 4
    `);
    if (services.rows.length < 4) {
      throw new Error('At least four active services are required to seed demo history.');
    }

    const customer = await client.query(`
      INSERT INTO users (
        email, password_hash, first_name, last_name, email_verified,
        role, status, mfa_enabled
      )
      VALUES ($1, $2, 'Demo', 'Customer', TRUE, 'client', 'active', FALSE)
      RETURNING user_id
    `, [DEMO_CUSTOMER_EMAIL, customerPasswordHash]);

    for (let index = 0; index < 4; index += 1) {
      const service = services.rows[index];
      await client.query(`
        INSERT INTO appointments (
          user_id, service_id, booked_service_price, booked_reservation_fee,
          payment_status, appointment_date, appointment_time, appointment_end_time,
          appointment_status, aesthetician_id, is_demo
        )
        VALUES (
          $1, $2, $3, $4, 'unpaid', CURRENT_DATE - $5::integer,
          '10:00'::time, '10:00'::time + ($6 * INTERVAL '1 minute'),
          'completed', NULL, TRUE
        )
      `, [
        customer.rows[0].user_id,
        service.service_id,
        service.service_price,
        service.reservation_fee,
        14 + (index * 14),
        service.duration_minutes,
      ]);
    }

    createSecureCredentialFile(filePath, `${DEMO_CUSTOMER_EMAIL}\n${customerPassword}\n`);
    credentialFileCreated = true;
    commitAttempted = true;
    await client.query('COMMIT');
  } catch (error) {
    if (transactionStarted && !commitAttempted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Demo setup rollback failed:', rollbackError.message);
      }
    }
    if (credentialFileCreated && !commitAttempted) fs.unlinkSync(filePath);
    if (commitAttempted) {
      console.error('The COMMIT outcome may be unknown. The credential file was preserved; inspect the target database before retrying. The unique demo email and existing-account check prevent a duplicate account.');
    }
    throw error;
  } finally {
    if (client) client.release();
    await db.pool.end();
  }

  console.log(`Created the demo customer and four synthetic appointments. Credentials are in ${filePath}.`);
}

async function suspendDemoCustomer() {
  assertOperationConfirmation('disable');
  let client;
  try {
    client = await db.pool.connect();
    await assertConnectedDemoDatabaseTarget(client);
    const result = await client.query(`
      UPDATE users
      SET status = 'suspended'
      WHERE LOWER(email) = $1 AND role = 'client'
      RETURNING user_id
    `, [DEMO_CUSTOMER_EMAIL]);
    if (!result.rows.length) throw new Error('The demo customer account was not found.');
    console.log('The demo customer account is suspended.');
  } finally {
    if (client) client.release();
    await db.pool.end();
  }
}

async function retireDemoCustomer() {
  assertOperationConfirmation('retire');
  let client;
  try {
    client = await db.pool.connect();
    await assertConnectedDemoDatabaseTarget(client);
    await client.query('BEGIN');
    const account = await client.query(`
      SELECT user_id
      FROM users
      WHERE LOWER(email) = $1 AND role = 'client'
      FOR UPDATE
    `, [DEMO_CUSTOMER_EMAIL]);
    if (!account.rows.length) throw new Error('The demo customer account was not found.');

    const userId = account.rows[0].user_id;
    const appointments = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM appointments
      WHERE user_id = $1 AND is_demo = TRUE
    `, [userId]);
    const realAppointments = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM appointments
      WHERE user_id = $1 AND is_demo = FALSE
    `, [userId]);
    if (appointments.rows[0].count !== 4 || realAppointments.rows[0].count !== 0) {
      throw new Error('Retirement requires exactly four synthetic appointments and no non-demo appointments; no data was removed.');
    }

    await client.query('DELETE FROM appointments WHERE user_id = $1 AND is_demo = TRUE', [userId]);
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    console.log('The demo customer and its four synthetic appointments were retired.');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client) client.release();
    await db.pool.end();
  }
}

async function main(args) {
  const credentialFile = process.env.DEMO_CUSTOMER_CREDENTIAL_FILE;
  if (args.length === 1 && args[0] === '--disable') {
    await suspendDemoCustomer();
    return;
  }
  if (args.length === 1 && args[0] === '--retire') {
    await retireDemoCustomer();
    return;
  }
  if (args.length !== 1 || args[0] !== '--create') {
    throw new Error('Choose exactly one operation: --create, --disable, or --retire.');
  }
  if (!credentialFile) {
    throw new Error('Set DEMO_CUSTOMER_CREDENTIAL_FILE to a new path outside the repository.');
  }
  await createDemoCustomer(credentialFile);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((error) => {
      console.error('Demo customer setup failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  assertCredentialFileIsOutsideRepository,
  createPassword,
};
