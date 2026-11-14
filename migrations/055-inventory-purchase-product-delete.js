const db = require('../db');

async function migrate(client) {
  await client.query(`
    ALTER TABLE inventory_purchase_records
      ALTER COLUMN product_id DROP NOT NULL,
      DROP CONSTRAINT IF EXISTS inventory_purchase_records_product_id_fkey,
      ADD CONSTRAINT inventory_purchase_records_product_id_fkey
        FOREIGN KEY (product_id)
        REFERENCES inventory_products(product_id)
        ON DELETE SET NULL
  `);
}

if (require.main === module) {
  db.transaction(migrate)
    .then(() => console.log('Inventory purchase history can retain deleted product records.'))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
