const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Admin and Finance Officer share Finance pages, navigation, and review APIs', () => {
  const server = read('index.js');
  const adminNavigation = read('admin-context-nav.js');
  const expensesPage = read('FinanceExpenses.html');
  const expensesClient = read('finance-expenses.js');
  const financeApi = read('routes/finance.js');

  for (const page of ['FinanceDashboard', 'FinancesTransactions', 'FinanceExpenses', 'FinanceReports']) {
    assert.match(
      server,
      new RegExp(`path: '\\/${page}\\.html', roles: \\['finance_officer', 'admin'\\]`),
      `${page} should be available to both Finance Officers and Admins`,
    );
    assert.match(
      adminNavigation,
      new RegExp(`\\["${page}\\.html",`),
      `${page} should appear in Admin navigation`,
    );
  }

  assert.match(expensesPage, /id="pendingExpenseReviewBtn"/);
  assert.match(expensesPage, /id="pendingPurchaseDetailModal"/);
  assert.match(expensesPage, /Confirm &amp; Record Expense/);
  assert.match(expensesPage, /data-close-purchase-details/);
  assert.match(expensesPage, /<script src="admin-context-nav\.js"><\/script>/);
  assert.match(expensesClient, /\/api\/finance\/inventory-purchase-suggestions/);
  assert.doesNotMatch(expensesClient, /pendingPurchaseBackBtn/);
  const detailFlow = expensesClient.slice(
    expensesClient.indexOf('async function openPurchaseReviewDetails'),
    expensesClient.indexOf('function closePurchaseReviewDetails'),
  );
  assert.ok(
    detailFlow.indexOf('openModal(elements.pendingPurchaseDetailModal)')
      < detailFlow.indexOf('await common.fetchJson'),
    'the separate details modal should open immediately and show loading/errors',
  );
  assert.match(financeApi, /router\.use\(requireRole\('finance_officer', 'admin'\)\)/);
});

test('Finance Dashboard applies the same Admin navigation context', () => {
  const dashboard = read('FinanceDashboard.html');
  const adminNavigation = read('admin-context-nav.js');

  assert.match(dashboard, /<script src="admin-context-nav\.js"><\/script>/);
  assert.match(adminNavigation, /\["FinanceDashboard\.html",\s*"Finance Dashboard"/);
  assert.match(adminNavigation, /pages: links\.slice\(6, 10\)/);
});
