const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS customer_id INT NULL
        REFERENCES users(user_id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS payments_customer_id_created_at_idx
        ON payments (customer_id, created_at DESC)
        WHERE customer_id IS NOT NULL;
    `);
    console.log('Finance product-sale client links are ready.');
  } catch (error) {
    console.error('Finance product-sale client-link migration failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  migrate()
    .catch(() => { process.exitCode = 1; })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
