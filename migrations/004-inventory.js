const db = require('../db');

async function createInventoryTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_products (
        product_id SERIAL PRIMARY KEY,

        product_name VARCHAR(255) NOT NULL,

        category VARCHAR(100) NOT NULL,

        stock_quantity INTEGER NOT NULL DEFAULT 0
          CHECK (stock_quantity >= 0),

        expiry_date DATE,

        created_at TIMESTAMP DEFAULT NOW(),

        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Inventory products table created successfully.');

    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        transaction_id SERIAL PRIMARY KEY,

        product_id INTEGER NOT NULL
          REFERENCES inventory_products(product_id)
          ON DELETE CASCADE,

        transaction_type VARCHAR(50) NOT NULL
          CHECK (
            transaction_type IN (
              'Restock',
              'Used in Service',
              'Adjustment',
              'Disposed / Expired'
            )
          ),

        quantity INTEGER NOT NULL,

        previous_stock INTEGER NOT NULL
          CHECK (previous_stock >= 0),

        new_stock INTEGER NOT NULL
          CHECK (new_stock >= 0),

        created_by INTEGER
          REFERENCES users(user_id)
          ON DELETE SET NULL,

        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Inventory transactions table created successfully.');

  } catch (error) {
    console.error('Error creating inventory tables:', error);
  } finally {
    process.exit();
  }
}

createInventoryTables();