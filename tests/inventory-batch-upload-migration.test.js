const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../migrations/056-allow-repeated-inventory-purchase-batches');
const packageJson = require('../package.json');
const migrationRegistry = require('../migrations/registry.json');

test('repeated receipt migration removes the unique source-hash constraint', async () => {
  let migrationSql = '';
  await migrate({
    query: async (sql) => {
      migrationSql = sql;
    },
  });

  assert.match(migrationSql, /DROP CONSTRAINT IF EXISTS inventory_purchase_batches_source_hash_key/);
  assert.ok(migrationRegistry.required.includes('056-allow-repeated-inventory-purchase-batches.js'));
  assert.match(packageJson.scripts['migrate:inventory-repeat-purchases'], /--target=056-allow-repeated-inventory-purchase-batches\.js/);
  assert.match(packageJson.scripts['migrate:finance-sales-purchases'], /--target=056-allow-repeated-inventory-purchase-batches\.js/);
});
