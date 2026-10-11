const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE inventory_transactions
        DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check,
        ADD CONSTRAINT inventory_transactions_transaction_type_check
          CHECK (transaction_type IN (
            'Restock',
            'Used in Service',
            'Adjustment',
            'Expired',
            'Deleted',
            'Sale',
            'Sale Reversed'
          ));

      CREATE TABLE IF NOT EXISTS product_sale_details (
        payment_id INTEGER PRIMARY KEY REFERENCES payments(payment_id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES inventory_products(product_id) ON DELETE RESTRICT,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
        request_key UUID NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory_purchase_batches (
        purchase_batch_id SERIAL PRIMARY KEY,
        request_key UUID NOT NULL UNIQUE,
        source_hash CHAR(64) UNIQUE,
        payload_hash CHAR(64) NOT NULL,
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
        CHECK (payload_hash ~ '^[0-9a-f]{64}$')
      );

      CREATE TABLE IF NOT EXISTS inventory_purchase_records (
        purchase_id SERIAL PRIMARY KEY,
        purchase_batch_id INTEGER NOT NULL REFERENCES inventory_purchase_batches(purchase_batch_id) ON DELETE RESTRICT,
        row_number INTEGER NOT NULL CHECK (row_number > 0),
        inventory_transaction_id INTEGER NOT NULL UNIQUE REFERENCES inventory_transactions(transaction_id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES inventory_products(product_id) ON DELETE RESTRICT,
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
        purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
        expense_id INTEGER UNIQUE REFERENCES expenses(expense_id) ON DELETE RESTRICT,
        reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (purchase_batch_id, row_number),
        CHECK ((expense_id IS NULL AND reviewed_at IS NULL) OR (expense_id IS NOT NULL AND reviewed_at IS NOT NULL))
      );

      CREATE INDEX IF NOT EXISTS inventory_purchase_suggestions_idx
        ON inventory_purchase_records (purchase_date, purchase_id)
        WHERE expense_id IS NULL;
    `);
  });
  console.log('Finance product sales and purchase expense tables are ready.');
}

if (require.main === module) {
  migrate()
    .then(() => db.pool.end())
    .catch((error) => {
      console.error('Finance product sales and purchase migration failed:', error);
      process.exitCode = 1;
      db.pool.end();
    });
}

module.exports = migrate;
