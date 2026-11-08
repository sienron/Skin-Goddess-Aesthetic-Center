const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { INVENTORY_CATEGORIES, isInventoryCategory } = require('../utils/inventoryCategories');

const root = path.join(__dirname, '..');

test('only the seven inventory dropdown categories are accepted', () => {
  assert.equal(INVENTORY_CATEGORIES.length, 7);
  for (const category of INVENTORY_CATEGORIES) {
    assert.equal(isInventoryCategory(category), true);
  }
  assert.equal(isInventoryCategory('Other'), false);
  assert.equal(isInventoryCategory(' Medical/Injection Supplies'), false);
  assert.equal(isInventoryCategory(null), false);
});

test('inventory create, edit, and batch-upload routes use the category allow-list', () => {
  const routeSource = fs.readFileSync(path.join(root, 'routes', 'inventory.js'), 'utf8');

  assert.match(routeSource, /if \(!isInventoryCategory\(row\.category\)\)/);
  assert.match(routeSource, /if \(!isInventoryCategory\(category\)\)/g);
  assert.equal([...routeSource.matchAll(/if \(!isInventoryCategory\(category\)\)/g)].length, 2);
});

test('restocked-today count uses the Manila calendar-day boundary', () => {
  const routeSource = fs.readFileSync(path.join(root, 'routes', 'inventory.js'), 'utf8');
  const handler = routeSource.slice(
    routeSource.indexOf("router.get('/restocked-today'"),
    routeSource.indexOf("router.get('/deducted-today'")
  );

  assert.match(handler, /NOW\(\) AT TIME ZONE 'Asia\/Manila'/);
  assert.doesNotMatch(handler, /CURRENT_DATE/);
});

test('inventory and transaction pages expose a responsive sidebar toggle', () => {
  for (const file of ['InventoryManagement.html', 'InventoryTransactions.html']) {
    const page = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(page, /id="sidebarToggle"/);
    assert.match(page, /id="invSidebar"/);
    assert.match(page, /id="sidebarBackdrop"/);
  }
});

test('stock transaction pages include the account menu and its click handler', () => {
  for (const file of ['InventoryTransactions.html', 'AdminInventoryTransactions.html']) {
    const page = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(page, /id="adminProfileBtn"/);
    assert.match(page, /id="adminProfileMenu"/);
    assert.match(page, /src="admin-dashboard\.js"/);
  }
});
