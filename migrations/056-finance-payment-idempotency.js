const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS request_key UUID
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS payments_request_key_unique
      ON payments (request_key)
      WHERE request_key IS NOT NULL
    `);
  });
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Finance payment idempotency migration completed.'))
    .catch((error) => {
      console.error('Finance payment idempotency migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
