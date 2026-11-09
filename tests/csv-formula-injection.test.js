const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../db');
const financeRouter = require('../routes/finance');
const { escapeCsvCell } = require('../utils/csv');

const root = path.join(__dirname, '..');
const originalQuery = db.query;
const financeCsvHandler = financeRouter.stack
  .find((layer) => layer.route?.path === '/export.csv' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const attackValues = [
  '=1+1',
  '+SUM(1,1)',
  '-1+1',
  '@SUM(1,1)',
  '  =HYPERLINK("https://example.invalid","open")',
  '\t+1+1',
  '\r\n@SUM(1,1)',
  '\u0000\u001f-1+1',
  '\uFEFF=1+1',
  '\u200b@SUM(1,1)',
];

function createBrowserCsvExport() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'csv-export.js'), 'utf8'), context);
  return context.window.CsvExport;
}

test('server and browser CSV encoders neutralize formula prefixes after whitespace and controls', () => {
  const browserCsv = createBrowserCsvExport();

  attackValues.forEach((value) => {
    const expected = `"'${value.replace(/"/g, '""')}"`;
    assert.equal(escapeCsvCell(value), expected);
    assert.equal(browserCsv.escapeCell(value), expected);
  });
});

test('CSV encoders preserve ordinary text and numeric values while escaping CSV quotes', () => {
  const ordinary = 'O\'Neil, Serum "Plus"';
  assert.equal(escapeCsvCell(ordinary), '"O\'Neil, Serum ""Plus"""');
  assert.equal(createBrowserCsvExport().escapeCell(ordinary), '"O\'Neil, Serum ""Plus"""');
  assert.equal(escapeCsvCell(-12.5), '"-12.5"');
  assert.equal(escapeCsvCell(null), '""');
});

test('finance and user CSV exports consistently use the protected encoders', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('routes/finance.js'), /row\.map\(escapeCsvCell\)/);
  assert.match(read('finance-reports.js'), /CsvExport\.escapeCell\(value\)/);
  assert.match(read('Usermanagement.js'), /row\.map\(CsvExport\.escapeCell\)/);
  assert.match(read('FinanceReports.html'), /<script src="csv-export\.js"><\/script>/);
  assert.match(read('Usermanagement.html'), /<script src="csv-export\.js"><\/script>/);
  assert.match(read('scripts/build-public.js'), /'csv-export\.js'/);
});

test('finance CSV endpoint neutralizes formula-like database fields without changing stored data', async () => {
  const maliciousValues = [
    '\t=HYPERLINK("https://example.invalid","category")',
    '\r\n+SUM(1,1)',
    '\u0000-1+1',
    '\uFEFF@SUM(1,1)',
  ];
  let storedValues;
  db.query = async (sql) => {
    assert.match(sql, /FROM expenses/);
    storedValues = maliciousValues;
    return {
      rows: [{
        date: '2026-11-01',
        category: maliciousValues[0],
        description: maliciousValues[1],
        amount: 12,
        supplier: maliciousValues[2],
        reference_no: maliciousValues[3],
        status: 'active',
        void_reason: null,
      }],
    };
  };
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };

  try {
    await financeCsvHandler({
      query: { section: 'expenses', from: '2026-11-01', to: '2026-11-30' },
    }, response);
    assert.equal(response.statusCode, undefined);
    assert.equal(response.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.ok(response.body.startsWith('\uFEFF'));
    maliciousValues.forEach((value) => {
      assert.ok(response.body.includes(`"'${value.replace(/"/g, '""')}"`));
    });
    assert.deepEqual(storedValues, maliciousValues);
  } finally {
    db.query = originalQuery;
  }
});

test.after(() => {
  db.query = originalQuery;
});
