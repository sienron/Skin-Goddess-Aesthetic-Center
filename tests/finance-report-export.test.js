const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const db = require('../db');
const financeRouter = require('../routes/finance');

function routeHandler(method, routePath) {
  const layer = financeRouter.stack.find((item) =>
    item.route?.path === routePath && item.route.methods[method]
  );
  assert.ok(layer, `${method.toUpperCase()} ${routePath} route should be registered`);
  return layer.route.stack.at(-1).handle;
}

const retiredXlsxRoute = routeHandler('post', '/export-report.xlsx');
const legacyXlsxRoute = routeHandler('get', '/export.xlsx');
const legacyCsvRoute = routeHandler('get', '/export.csv');
const monthlyRoute = routeHandler('get', '/monthly');

function financeRows(sql) {
  if (/SELECT payment\.payment_id/.test(sql)) {
    return { rows: [
      { payment_id: 2, appointment_date: null, date: '2026-10-03', receipt_number: 'SG-RCT-2026-00000002', payment_type: 'product_sale', method: 'cash', amount: 200, status: 'posted', reference_no: 'POS-2', note: null, client: 'Client Two', details: 'Cleanser × 1' },
      { payment_id: 3, appointment_date: '2026-10-04', date: '2026-10-04', receipt_number: 'SG-RCT-2026-00000003', payment_type: 'reservation', method: 'cash', amount: 100, status: 'refunded', reference_no: 'APT-3', note: null, client: 'Client Three', details: 'Facial' }
    ] };
  }
  if (/SELECT expense_id, expense_date::text AS date/.test(sql)) {
    return { rows: [
      { expense_id: 4, date: '2026-10-05', category: 'Rent', description: 'Clinic rent', amount: 400, supplier: 'Landlord', reference_no: 'R-4', status: 'active', void_reason: null },
      { expense_id: 5, date: '2026-10-06', category: 'Utilities', description: 'Voided bill', amount: 25, supplier: null, reference_no: null, status: 'voided', void_reason: 'Duplicate' }
    ] };
  }
  if (/SELECT\s+a\.appointment_id,/.test(sql) && /appointment_date BETWEEN/.test(sql)) {
    return { rows: [{
      appointment_id: 42,
      appointment_date: '2026-10-10',
      client: 'Client One',
      service: 'Facial',
      service_price: 1000,
      amount_paid: 300,
      outstanding: 700,
    }] };
  }
  throw new Error(`Unexpected finance export query: ${sql}`);
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

test('Admin and Finance Officer reach shared Reports charts from their own navigation', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const page = read('FinanceReports.html');
  const client = read('finance-record-exports.js');
  const adminNavigation = read('admin-context-nav.js');
  const server = read('index.js');
  const styles = read('style.css');

  assert.match(server, /\{\s*path:\s*'\/FinanceReports\.html',\s*roles:\s*\['finance_officer',\s*'admin'\]\s*\}/);
  assert.doesNotMatch(page, /data-finance-record-export|Financial record exports/i);
  assert.match(page, /id="reportFrom"/);
  assert.match(page, /id="reportTo"/);
  assert.match(page, /<script src="admin-context-nav\.js"><\/script>/);
  assert.match(page, /Finance navigation/);
  assert.match(adminNavigation, /\["FinanceReports\.html",\s*"Reports"/);
  assert.match(adminNavigation, /if \(account\.role !== "admin"\) return/);
  assert.match(client, /common\.bindPeriodControls/);
  assert.doesNotMatch(client, /export-report\.xlsx|income-statement/);
  assert.doesNotMatch(styles, /fin-report-toolbar-export/);
});

test('ordinary payment, expense, and receivable XLSX exports remain available', async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    return financeRows(sql);
  };

  try {
    for (const [section, sheetName] of [
      ['transactions', 'Payment Ledger'],
      ['expenses', 'Expense Register'],
      ['receivables', 'Outstanding Balances'],
    ]) {
      const response = responseCapture();
      await legacyXlsxRoute({
        query: {
          section,
          from: '2026-10-01',
          to: '2026-10-31',
          ...(section === 'receivables' ? { q: 'Client One' } : {}),
        },
      }, response);

      assert.equal(response.statusCode, 200);
      assert.ok(Buffer.isBuffer(response.body));
      assert.match(response.headers['Content-Disposition'], /\.xlsx"$/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);
      const sheet = workbook.getWorksheet(sheetName);
      assert.ok(sheet, `${section} export should retain its record workbook`);
      assert.ok(sheet.rowCount > 6, `${section} workbook should contain record rows`);
    }

    for (const [section, expectedContent] of [
      ['transactions', 'POS-2'],
      ['expenses', 'Clinic rent'],
    ]) {
      const response = responseCapture();
      await legacyCsvRoute({
        query: { section, from: '2026-10-01', to: '2026-10-31' },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(typeof response.body, 'string');
      assert.match(response.body, new RegExp(expectedContent));
    }
  } finally {
    db.query = originalQuery;
  }

  assert.equal(queries.length, 5);
  assert.match(queries[0].sql, /SELECT payment\.payment_id/);
  assert.match(queries[1].sql, /SELECT expense_id,/);
  assert.match(queries[2].sql, /appointment_date BETWEEN/);
});

test('obsolete accounting statement export routes return 410 without querying data', async () => {
  const originalQuery = db.query;
  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    throw new Error('Retired statement exports must not query finance data.');
  };

  try {
    for (const [handler, request] of [
      [retiredXlsxRoute, { body: { from: '2026-10-01', to: '2026-10-31' } }],
      [legacyXlsxRoute, { query: { section: 'income-statement' } }],
      [legacyCsvRoute, { query: { section: 'income-statement' } }],
    ]) {
      const response = responseCapture();
      await handler(request, response);
      assert.equal(response.statusCode, 410);
      assert.deepEqual(response.body, { message: 'Accounting statement exports have been retired.' });
    }
  } finally {
    db.query = originalQuery;
  }

  assert.equal(queryCount, 0);
});

test('Reports shows four operational charts without statement generation', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const page = read('FinanceReports.html');
  const client = read('finance-record-exports.js');

  assert.doesNotMatch(page, /incomeStatementSection|income-statement/i);
  const charts = [
    'collected-services', 'appointment-source', 'appointment-payment-status', 'payment-counts'
  ];
  for (const chart of charts) {
    assert.match(page, new RegExp(`data-chart-export="${chart}"`));
  }
  assert.equal((page.match(/<canvas\b/g) || []).length, charts.length);
  assert.doesNotMatch(page, /Net cash after expenses|Income exports include posted payments only/i);
  assert.doesNotMatch(client, /export-report\.xlsx|income-statement/i);
  assert.match(page, /finance-reports\.js/);
  assert.doesNotMatch(page, /recordExportKind|recordExportDirection|recordExportStatus/);
});

test('chart workbooks select the matching underlying records and date range', async () => {
  const originalQuery = db.query;
  const cases = [
    ['sales-expenses', /Completed appointment[\s\S]*Product sale[\s\S]*Retained deposit[\s\S]*Recorded expense/, 'Sales and Expenses'],
    ['top-services', /WITH revenue AS[\s\S]*GROUP BY service[\s\S]*LIMIT 5/, 'Top Services'],
    ['service-categories', /WITH revenue AS[\s\S]*FROM revenue\s+ORDER BY/, 'Service Categories'],
    ['online-reservations', /p\.payment_type = 'reservation'[\s\S]*p\.status = 'posted'[\s\S]*paymongo_checkout_sessions/, 'Online Reservations'],
    ['payment-methods', /p\.status = 'posted'[\s\S]*COALESCE\(a\.is_demo, FALSE\) = FALSE[\s\S]*ORDER BY p\.method/, 'Payment Methods'],
    ['deposits', /p\.status = 'refunded'[\s\S]*p\.status = 'reversed'[\s\S]*deposit_group[\s\S]*p\.payment_type = 'reservation'/, 'Deposit Summary'],
    ['expense-categories', /voided_at IS NULL/, 'Expense Categories'],
  ];
  try {
    for (const [chart, expectedQuery, title] of cases) {
      db.query = async (sql, values) => {
        assert.match(sql, expectedQuery);
        assert.deepEqual(values.slice(0, 2), ['2026-10-10', '2026-10-20']);
        return { rows: [{ date: '2026-10-15', record_type: 'Payment', record_id: '12', amount: 125, reference: '=literal' }] };
      };
      const response = responseCapture();
      await legacyXlsxRoute({ query: { section: 'report-chart', chart, from: '2026-10-10', to: '2026-10-20' } }, response);
      assert.equal(response.statusCode, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body);
      const sheet = workbook.getWorksheet(title);
      assert.equal(sheet.getCell('J2').value, '=literal');
      assert.equal(sheet.getCell('K2').value, 125);
      assert.equal(sheet.views[0].ySplit, 1);
    }
    const invalid = responseCapture();
    await legacyXlsxRoute({ query: { section: 'report-chart', chart: 'unknown', from: '2026-10-10', to: '2026-10-20' } }, invalid);
    assert.equal(invalid.statusCode, 400);
  } finally {
    db.query = originalQuery;
  }
});

test('monthly trend restricts partial months to the selected dates', async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [{ month: '2026-10', amount: queries.length === 1 ? 100 : 30 }] };
  };
  try {
    const response = responseCapture();
    await monthlyRoute({ query: { from: '2026-10-10', to: '2026-10-20' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [{ month: '2026-10', sales: 100, expenses: 30 }]);
    assert.deepEqual(queries[0].values.slice(0, 2), ['2026-10-10', '2026-10-20']);
    assert.deepEqual(queries[1].values, ['2026-10-10', '2026-10-20']);
    assert.match(queries[0].sql, /a\.is_demo = FALSE/);
    assert.match(queries[1].sql, /voided_at IS NULL/);
  } finally {
    db.query = originalQuery;
  }
});

test('report charts load selected ranges and export their own record sets', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'finance-reports.js'), 'utf8');
  const buttons = ['collected-services', 'appointment-source', 'appointment-payment-status', 'payment-counts'].map((kind) => ({
    dataset: { chartExport: kind },
    addEventListener(_type, handler) { this.click = handler; }
  }));
  const requests = [];
  const charts = new Map();
  const report = {
    revenue_by_service: [{ label: 'Facial', value: 100 }],
    appointment_source: [{ label: 'Unknown', value: 1 }],
    payment_status: [{ label: 'Unpaid', value: 2 }],
    payment_methods: [{ label: 'cash', value: 3 }]
  };
  const common = {
    rangeParams(from, to) { return new URLSearchParams({ from, to }).toString(); },
    async fetchJson(url) {
      requests.push(url);
      return report;
    },
    renderChart(id, config) { charts.set(id, config); },
    formatPeso(value) { return `PHP ${value}`; },
    paymentMethodLabel(value) { return value; }
  };
  const message = { textContent: '' };
  const window = { FinanceCommon: common, location: { href: '' } };
  vm.runInNewContext(source, {
    window, URLSearchParams, Date, Promise, encodeURIComponent,
    document: {
      body: { classList: { contains: () => false } },
      getElementById: (id) => id === 'reportMessage' ? message : { closest: () => ({ style: {} }) },
      querySelectorAll: () => buttons,
    },
    MutationObserver: class { observe() {} },
  });

  await window.FinanceReports.load({ from: '2025-01-15', to: '2027-03-04' });
  assert.equal(charts.size, 4);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /from=2025-01-15&to=2027-03-04&view=operational/);
  assert.equal(charts.get('reportStatusChart').data.datasets[0].data[0], 2);
  assert.equal(charts.get('reportMethodsChart').data.datasets[0].data[0], 3);
  for (const button of buttons) {
    assert.equal(button.disabled, false);
    button.click();
    assert.match(window.location.href, /from=2025-01-15&to=2027-03-04/);
    assert.match(window.location.href, new RegExp(`section=report-chart&chart=${button.dataset.chartExport}`));
  }
});

test('outdated report responses show an actionable error and recover on reload', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'finance-reports.js'), 'utf8');
  const button = { dataset: { chartExport: 'collected-services' }, addEventListener(_type, handler) { this.click = handler; } };
  const message = { textContent: '' };
  const frame = { style: {}, querySelector: () => ({ textContent: '' }) };
  let report = { top_services: [] };
  let observerCallback;
  const common = {
    rangeParams: () => 'from=2026-10-01&to=2026-10-31',
    fetchJson: async () => report,
    renderChart() {},
    formatPeso: String,
    paymentMethodLabel: String,
  };
  const window = { FinanceCommon: common, location: { href: '' } };
  vm.runInNewContext(source, {
    window, encodeURIComponent,
    document: {
      body: { classList: { contains: () => false } },
      getElementById: (id) => id === 'reportMessage' ? message : { closest: () => frame },
      querySelectorAll: () => [button],
    },
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
  });
  const range = { from: '2026-10-01', to: '2026-10-31' };
  await window.FinanceReports.load(range);
  assert.match(message.textContent, /unexpected response.*latest server/i);
  assert.equal(button.disabled, true);
  assert.doesNotThrow(() => observerCallback());

  report = { revenue_by_service: [], appointment_source: [], payment_status: [], payment_methods: [] };
  await window.FinanceReports.load(range);
  assert.equal(message.textContent, '');
  assert.equal(button.disabled, false);
});
