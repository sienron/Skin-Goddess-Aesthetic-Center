const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../migrations/055-inventory-purchase-product-delete');

test('purchase history no longer prevents deleting an inventory product', async () => {
  let migrationSql = '';
  await migrate({
    query: async (sql) => {
      migrationSql = sql;
    }
  });

  assert.match(migrationSql, /ALTER COLUMN product_id DROP NOT NULL/);
  assert.match(migrationSql, /DROP CONSTRAINT IF EXISTS inventory_purchase_records_product_id_fkey/);
  assert.match(migrationSql, /FOREIGN KEY \(product_id\)\s+REFERENCES inventory_products\(product_id\)\s+ON DELETE SET NULL/);
});
