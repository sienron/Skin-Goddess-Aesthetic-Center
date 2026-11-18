const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('Admin and Finance Officer reach shared Reports record exports from their own navigation', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const page = read('FinanceReports.html');
  const client = read('finance-record-exports.js');
  const adminNavigation = read('admin-context-nav.js');
  const server = read('index.js');
  const styles = read('style.css');

  assert.match(server, /\{\s*path:\s*'\/FinanceReports\.html',\s*roles:\s*\['finance_officer',\s*'admin'\]\s*\}/);
  assert.match(page, /data-finance-record-export="income"/);
  assert.match(page, /data-finance-record-export="expenses"/);
  assert.match(page, /data-finance-record-export="payments"/);
  assert.match(page, /data-finance-record-export="ledger"/);
  assert.match(page, /data-finance-record-export="cash-closings"/);
  assert.match(page, /id="reportFrom"/);
  assert.match(page, /id="reportTo"/);
  assert.match(page, /<script src="admin-context-nav\.js"><\/script>/);
  assert.match(page, /Finance navigation/);
  assert.match(adminNavigation, /\["FinanceReports\.html",\s*"Reports"/);
  assert.match(adminNavigation, /if \(account\.role !== "admin"\) return/);
  assert.match(client, /document\.querySelectorAll\('\[data-finance-record-export\]'\)/);
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

test('Reports page retains no controls or client branch for statement generation', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const page = read('FinanceReports.html');
  const client = read('finance-record-exports.js');

  assert.doesNotMatch(page, /incomeStatementSection|income-statement/i);
  assert.doesNotMatch(page, /Finance summary|Sales earned|Cash collected|Recorded expenses|Net cash after expenses|Online reservation deposits|Payment method breakdown|Deposit \/ refund summary|Top services by revenue|Expenses by category|Revenue by service category|Daily cash summary/i);
  assert.doesNotMatch(client, /export-report\.xlsx|income-statement/i);
  assert.match(page, /data-finance-record-export="payments"/);
  assert.match(page, /data-finance-record-export="ledger"/);
  assert.match(page, /data-finance-record-export="cash-closings"/);
});
