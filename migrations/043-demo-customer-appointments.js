const db = require('../db');
const {
  assertConnectedDemoDatabaseTarget,
  assertDemoDatabaseTargetConfigured,
} = require('../utils/demoDatabaseTarget');

const MIGRATION_CONFIRMATION = 'ADD_DEMO_APPOINTMENT_MARKER_TO_SHARED_DATABASE';

async function migrate() {
  if (process.env.DEMO_CUSTOMER_SETUP_CONFIRM !== MIGRATION_CONFIRMATION
    || !process.env.DEMO_CUSTOMER_TARGET_DATABASE) {
    throw new Error(`Set DEMO_CUSTOMER_SETUP_CONFIRM=${MIGRATION_CONFIRMATION}, DEMO_CUSTOMER_TARGET_DATABASE, DEMO_CUSTOMER_TARGET_HOST, and DEMO_CUSTOMER_TARGET_PORT before migrating.`);
  }
  assertDemoDatabaseTargetConfigured();
  const client = await db.pool.connect();
  try {
    await assertConnectedDemoDatabaseTarget(client);
    await client.query(`
    ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE
    `);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Synthetic appointment marker is available.'))
    .catch((error) => {
      console.error('Demo appointment migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
