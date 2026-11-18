const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('Finance and Admin navigation expose the five finance modules', () => {
  for (const filename of ['FinanceDashboard.html', 'FinanceExpenses.html', 'FinanceReports.html', 'FinancesTransactions.html']) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(source, /href="FinanceDashboard\.html"/);
    assert.match(source, /href="FinancesTransactions\.html#income"/);
    assert.match(source, /href="FinanceExpenses\.html"/);
    assert.match(source, /href="FinancesTransactions\.html#ledger"/);
    assert.match(source, /href="FinanceReports\.html"/);
    assert.match(source, /Transaction Ledger/);
  }

  const adminPage = fs.readFileSync(path.join(root, 'AdminDashboard.html'), 'utf8');
  const adminNav = fs.readFileSync(path.join(root, 'admin-context-nav.js'), 'utf8');
  assert.match(adminPage, /adminFinanceMenu[\s\S]*?FinanceDashboard\.html[\s\S]*?FinancesTransactions\.html#income[\s\S]*?FinanceExpenses\.html[\s\S]*?FinancesTransactions\.html#ledger[\s\S]*?FinanceReports\.html/);
  assert.match(adminNav, /FinancesTransactions\.html#income/);
  assert.match(adminNav, /FinancesTransactions\.html#ledger/);
  assert.match(adminNav, /page\[0\] === "FinancesTransactions\.html#income"/);
  assert.match(adminNav, /pages: links\.slice\(6, 11\)/);
  assert.match(adminNav, /window\.addEventListener\("hashchange", refreshActiveLinks\)/);
});

test('Income stays posted-only and the combined transaction ledger preserves source boundaries', () => {
  const page = fs.readFileSync(path.join(root, 'FinancesTransactions.html'), 'utf8');
  const ledgerSource = fs.readFileSync(path.join(root, 'finance-ledger.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'routes', 'finance.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'FinanceDashboard.html'), 'utf8');

  assert.match(page, /id="transactionLedgerPanel"[^>]*hidden/);
  assert.match(page, /<\/ul>\s*<\/li>\s*<li class="nav-item"><a href="FinancesTransactions\.html#ledger"/);
  assert.match(dashboard, /href="FinancesTransactions\.html#receivables"/);
  assert.match(ledgerSource, /refs\.incomeStatus\.value = 'posted'/);
  assert.match(ledgerSource, /time not recorded/);
  assert.match(ledgerSource, /\/api\/finance\/ledger\?/);
  assert.match(backend, /'money_in'::text AS direction/);
  assert.match(backend, /'money_out'::text AS direction/);
  assert.match(backend, /TO_CHAR\(p\.created_at AT TIME ZONE 'Asia\/Manila'/);
  assert.match(backend, /NULL::text AS transaction_at/);
  assert.match(backend, /LEFT JOIN payment_reversals reversal/);
  assert.match(backend, /reversal\.reason/);
  assert.match(backend, /p\.reference_no::text AS reference_number/);
  assert.match(backend, /p\.status::text AS status/);
  assert.match(backend, /CASE WHEN e\.voided_at IS NULL THEN 'recorded' ELSE 'voided' END/);
  assert.match(page, /Refunds and reversals:[\s\S]*historical Money In payment rows[\s\S]*only posted payments count as received income[\s\S]*no separate cash-out row is inferred/);

  const ledgerQuery = backend.slice(
    backend.indexOf('const FINANCE_LEDGER_CTE'),
    backend.indexOf('function buildFinanceLedgerFilters')
  );
  assert.equal((ledgerQuery.match(/FROM payments p/g) || []).length, 1);
});

test('Finance dashboard shows posted income, pending reviews, recent transactions, and cash close status', () => {
  const page = fs.readFileSync(path.join(root, 'FinanceDashboard.html'), 'utf8');
  const monitoring = fs.readFileSync(path.join(root, 'finance-dashboard-monitoring.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'finance-dashboard.js'), 'utf8');

  assert.match(page, /Recorded Income/);
  assert.match(page, /id="dashPendingExpenseReviews"/);
  assert.match(page, /id="dashCashClosingStatus"/);
  assert.match(page, /id="dashNoShows">0<\/strong>\s*<\/div>\s*<div>\s*<span>Pending Expense Reviews/);
  assert.match(page, /id="dashPendingExpenseReviewDetails"[\s\S]*?<\/div>\s*<div>\s*<span>Daily Cash Closing/);
  assert.match(page, /Recent Transactions/);
  assert.match(monitoring, /\/api\/finance\/inventory-purchase-suggestions/);
  assert.match(monitoring, /\/api\/finance\/cash-closing/);
  assert.match(dashboard, /common\.formatPeso\(summary\.collected\)/);
});

test('Reports shows date-filtered operational charts without the record export section', () => {
  const page = fs.readFileSync(path.join(root, 'FinanceReports.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'finance-record-exports.js'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-public.js'), 'utf8');

  for (const label of [
    'Revenue by Service', 'Appointment Source', 'Payment Status', 'Payment Methods'
  ]) {
    assert.ok(page.includes(label), `${label} control should be present`);
  }
  for (const obsolete of ['Financial record exports', 'Income Records', 'Expense Records', 'Payment Records',
    'Transaction History', 'Cash Closing Records', 'Finance summary', 'Net cash after expenses', 'Income exports include posted payments only']) {
    assert.ok(!page.includes(obsolete), `Reports should no longer contain ${obsolete}`);
  }
  assert.match(page, /data-period="today"/);
  assert.match(page, /data-period="month"/);
  assert.match(page, /data-period="last-month"/);
  assert.match(page, /id="reportFrom"/);
  assert.match(page, /id="reportTo"/);
  assert.doesNotMatch(page, /id="recordExport(?:Direction|Classification|Method|Source|Status|Kind)"/);
  assert.match(page, /chart\.js/);
  assert.match(page, /finance-reports\.js/);
  assert.match(page, /finance-record-exports\.js\?v=/);
  assert.match(source, /common\.bindPeriodControls/);
  assert.match(build, /'finance-ledger\.js'/);
  assert.match(build, /'finance-record-exports\.js'/);
  assert.match(build, /'finance-reports\.js'/);
});

test('dashboard monitoring cards use pending review and server-business-date cash-close data', async () => {
  const source = fs.readFileSync(path.join(root, 'finance-dashboard-monitoring.js'), 'utf8');
  const elements = new Map([
    ['dashPendingExpenseReviews', { textContent: '' }],
    ['dashPendingExpenseReviewDetails', { textContent: '' }],
    ['dashCashClosingStatus', { textContent: '' }],
    ['dashCashClosingDetails', { textContent: '' }]
  ]);
  const requests = [];
  const common = {
    async fetchJson(url) {
      requests.push(url);
      if (url.endsWith('inventory-purchase-suggestions')) return [{ suggestion_id: 1 }, { suggestion_id: 2 }];
      return {
        business_date: '2026-11-17',
        expected_amount: 850,
        closing: { actual_amount: 800 }
      };
    },
    formatPeso(value) { return `PHP ${value}`; }
  };
  vm.runInNewContext(source, {
    window: { FinanceCommon: common },
    document: { getElementById: (id) => elements.get(id) || null },
    console: { error() {} },
    Promise
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(requests.sort(), [
    '/api/finance/cash-closing',
    '/api/finance/inventory-purchase-suggestions'
  ]);
  assert.equal(elements.get('dashPendingExpenseReviews').textContent, '2');
  assert.equal(elements.get('dashCashClosingStatus').textContent, 'Closed');
  assert.match(elements.get('dashCashClosingDetails').textContent, /2026-11-17.*Expected PHP 850.*Counted PHP 800/);
});

test('report date controls load presets and reject invalid ranges', () => {
  const source = fs.readFileSync(path.join(root, 'finance-record-exports.js'), 'utf8');
  const commonWindow = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'finance-common.js'), 'utf8'), {
    window: commonWindow
  });
  const common = commonWindow.FinanceCommon;
  const input = (value = '') => ({
    value,
    addEventListener(type, handler) { this[type] = handler; },
    removeAttribute() {},
    setAttribute() {},
    focus() {}
  });
  const controls = new Map([
    ['reportFrom', input()],
    ['reportTo', input()],
    ['reportMessage', { textContent: '' }]
  ]);
  const periodButtons = ['today', 'month', 'last-month'].map((period) => ({
    dataset: { period },
    classList: { toggle(name, active) { this[name] = active; } },
    addEventListener(type, handler) { this[type] = handler; }
  }));
  const ranges = [];
  let invalidated = false;
  const window = { FinanceReports: {
    load(range) { ranges.push(range); },
    invalidate() { invalidated = true; }
  } };
  vm.runInNewContext(source, {
    document: {
      getElementById: (id) => controls.get(id) || null,
      querySelectorAll: () => periodButtons
    },
    window: Object.assign(window, { FinanceCommon: common }),
    URLSearchParams
  });

  const today = common.manilaToday();
  assert.equal(controls.get('reportFrom').value, common.monthStart(today));
  assert.equal(controls.get('reportTo').value, today);
  periodButtons[0].click();
  assert.deepEqual(
    [controls.get('reportFrom').value, controls.get('reportTo').value],
    [today, today]
  );
  periodButtons[2].click();
  const lastMonth = common.lastMonthRange(today);
  assert.deepEqual(
    [controls.get('reportFrom').value, controls.get('reportTo').value],
    [lastMonth.from, lastMonth.to]
  );
  assert.equal(ranges.at(-1).from, lastMonth.from);
  assert.equal(ranges.at(-1).to, lastMonth.to);
  controls.get('reportFrom').value = '2026-10-31';
  controls.get('reportTo').value = '2026-10-01';
  controls.get('reportFrom').change();
  assert.equal(invalidated, true);
  assert.match(controls.get('reportMessage').textContent, /valid date range/i);
});
