const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('batch upload invalidates in-flight inventory refreshes before reloading inventory', () => {
  const inventoryClient = fs.readFileSync(path.join(root, 'InventoryManagement.js'), 'utf8').replace(/\r\n/g, '\n');
  const batchClient = fs.readFileSync(path.join(root, 'batch-upload.js'), 'utf8').replace(/\r\n/g, '\n');
  const invalidation = inventoryClient.indexOf(
    'window.addEventListener("inventory:batch-upload-confirmed", () => {\n    inventoryMutationVersion += 1;',
  );
  const confirmation = batchClient.slice(batchClient.indexOf('confirmButton.addEventListener'));

  assert.notEqual(invalidation, -1);
  assert.ok(
    confirmation.indexOf('window.dispatchEvent(new CustomEvent("inventory:batch-upload-confirmed"))')
      < confirmation.indexOf('await Promise.all(refreshFunctions'),
  );
});
