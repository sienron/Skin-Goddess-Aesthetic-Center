const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../migrations/056-allow-repeated-inventory-purchase-batches');
const packageJson = require('../package.json');

test('repeated receipt migration removes the unique source-hash constraint', async () => {
  let migrationSql = '';
  await migrate({
    query: async (sql) => {
      migrationSql = sql;
    },
  });

  assert.match(migrationSql, /DROP CONSTRAINT IF EXISTS inventory_purchase_batches_source_hash_key/);
  assert.match(packageJson.scripts['migrate:finance-sales-purchases'], /056-allow-repeated-inventory-purchase-batches\.js/);
  assert.match(packageJson.scripts.postmigrate, /056-allow-repeated-inventory-purchase-batches\.js/);
});
