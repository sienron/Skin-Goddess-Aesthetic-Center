const db = require('../db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE inventory_transactions
        ADD COLUMN IF NOT EXISTS product_name VARCHAR(255)
    `);

    await db.query(`
      UPDATE inventory_transactions stock_transaction
      SET product_name = product.product_name
      FROM inventory_products product
      WHERE stock_transaction.product_id = product.product_id
        AND stock_transaction.product_name IS NULL
    `);

    await db.query(`
      UPDATE inventory_transactions
      SET transaction_type = 'Expired'
      WHERE transaction_type = 'Disposed / Expired'
    `);

    await db.query(`
      ALTER TABLE inventory_transactions
        ALTER COLUMN product_id DROP NOT NULL,
        DROP CONSTRAINT IF EXISTS inventory_transactions_product_id_fkey,
        ADD CONSTRAINT inventory_transactions_product_id_fkey
          FOREIGN KEY (product_id)
          REFERENCES inventory_products(product_id)
          ON DELETE SET NULL,
        DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check,
        ADD CONSTRAINT inventory_transactions_transaction_type_check
          CHECK (transaction_type IN (
            'Restock',
            'Used in Service',
            'Adjustment',
            'Expired',
            'Deleted'
          ))
    `);

    console.log('Inventory transaction history is ready.');
  } catch (error) {
    console.error('Inventory transaction log migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
