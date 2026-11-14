const db = require('../db');

async function migrate(client) {
  await client.query(`
    ALTER TABLE inventory_purchase_batches
      DROP CONSTRAINT IF EXISTS inventory_purchase_batches_source_hash_key
  `);
}

if (require.main === module) {
  db.transaction(migrate)
    .then(() => console.log('Repeated inventory purchase batches are enabled.'))
    .catch((error) => {
      console.error('Repeated inventory purchase batch migration failed:', error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
