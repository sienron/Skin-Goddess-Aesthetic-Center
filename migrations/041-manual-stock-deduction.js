const db = require('../db');

async function migrate() {
  await db.query(`
    ALTER TABLE inventory_transactions
      DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check,
      ADD CONSTRAINT inventory_transactions_transaction_type_check
        CHECK (transaction_type IN (
          'Restock',
          'Used in Service',
          'Manual Stock Deduction',
          'Adjustment',
          'Expired',
          'Deleted',
          'Sale',
          'Sale Reversed'
        ))
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Manual inventory stock deductions are enabled in the transaction log.'))
    .catch((error) => {
      console.error('Manual stock deduction migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
