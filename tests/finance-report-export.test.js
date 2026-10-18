const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const db = require('../db');
const financeRouter = require('../routes/finance');

const exportRoute = financeRouter.stack
  .find((layer) => layer.route?.path === '/export-report.xlsx' && layer.route.methods.post)
  .route.stack.at(-1).handle;
const legacyExportRoute = financeRouter.stack
  .find((layer) => layer.route?.path === '/export.xlsx' && layer.route.methods.get)
  .route.stack.at(-1).handle;

test('Admin and Finance Officer reach the visible shared Reports export from their own navigation', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const page = read('FinanceReports.html');
  const client = read('finance-reports.js');
  const adminNavigation = read('admin-context-nav.js');
  const server = read('index.js');

  assert.match(server, /\{\s*path:\s*'\/FinanceReports\.html',\s*roles:\s*\['finance_officer',\s*'admin'\]\s*\}/);
  assert.match(page, /data-export="income-statement">Export All Reports \(Excel\)<\/button>/);
  assert.match(page, /<script src="admin-context-nav\.js"><\/script>/);
  assert.match(page, /Finance navigation/);
  assert.match(adminNavigation, /\["FinanceReports\.html",\s*"Reports"/);
  assert.match(adminNavigation, /if \(account\.role !== "admin"\) return/);
  assert.match(client, /exportButtons\.forEach\(\(button\) => button\.addEventListener\('click'/);
  assert.match(client, /fetch\('\/api\/finance\/export-report\.xlsx'/);
  assert.match(client, /method:\s*'POST'/);
});

function financeRows(sql) {
  if (/SELECT sale_date::text AS date, source/.test(sql)) {
    return { rows: [
      { date: '2026-10-02', source: 'Completed appointment', record_id: 'APT-1', receipt_number: null, appointment_id: '1', client: 'Client One', details: 'Facial', payment_status: 'not applicable', appointment_status: 'completed', amount: 1000, recognition_rule: 'Completed service' },
      { date: '2026-10-03', source: 'Posted product sale', record_id: 'PAY-2', receipt_number: 'SG-RCT-2026-00000002', appointment_id: null, client: 'Client Two', details: 'Cleanser × 1', payment_status: 'posted', appointment_status: 'not applicable', amount: 200, recognition_rule: 'Posted product sale' }
    ] };
  }
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
  if (/SELECT appointment\.appointment_id,\s+appointment\.appointment_date::text AS transaction_date/.test(sql)) {
    return { rows: [{
      appointment_id: 1,
      transaction_date: '2026-10-02',
      client: 'Client One',
      service_name: 'Facial',
      original_amount: 1000,
      amount_paid: 300,
      outstanding: 700,
      status: 'Partially paid'
    }] };
  }
  if (/payment_date/.test(sql) && /appointment_status IN/.test(sql)) {
    return { rows: [{
      appointment_id: 6,
      payment_date: '2026-10-08',
      receipt_number: 'SG-RCT-2026-00000006',
      client: 'Client Six',
      amount: 250,
      appointment_status: 'confirmed'
    }] };
  }
  if (/SELECT reversal\.reversal_id/.test(sql)) {
    return { rows: [{
      reversal_id: 1,
      reversed_at: new Date('2026-10-09T04:00:00.000Z'),
      date: '2026-10-09',
      payment_id: 2,
      receipt_number: 'SG-RCT-2026-00000002',
      appointment_id: null,
      payment_type: 'product_sale',
      amount: 20,
      method: 'cash',
      reason: 'Correction',
      client: 'Client Two'
    }] };
  }
  if (/SELECT product_id, product_name, category, stock_quantity/.test(sql)) {
    return { rows: [
      { product_id: 1, product_name: 'Cleanser', category: 'Retail', stock_quantity: 5, unit_cost: 10, inventory_value: 50 },
      { product_id: 2, product_name: 'Serum', category: 'Retail', stock_quantity: 2, unit_cost: null, inventory_value: null }
    ] };
  }
  if (/SUM\(GREATEST\(a\.booked_service_price/.test(sql)) {
    return { rows: [{ amount: 700 }] };
  }
  if (/FROM \(\s*SELECT a\.appointment_date AS sale_date/.test(sql)) {
    return { rows: [{ amount: 1200 }] };
  }
  if (/FROM payments WHERE status = 'posted' AND \(created_at AT TIME ZONE 'Asia\/Manila'\)/.test(sql)) {
    return { rows: [{ amount: 500 }] };
  }
  if (/FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN/.test(sql)) {
    return { rows: [{ amount: 400 }] };
  }
  if (/generate_series\(\$1::date, \$2::date, '1 day'\) day/.test(sql) && /collected/.test(sql)) {
    return { rows: [{ date: '2026-10-03', collected: 200, expenses: 0 }] };
  }
  if (/COUNT\(p\.payment_id\)::int AS count/.test(sql)) return { rows: [] };
  if (/SELECT category, SUM\(amount\)::float8 AS amount FROM \(/.test(sql)) return { rows: [] };
  if (/SELECT CASE WHEN p\.status = 'refunded'/.test(sql)) return { rows: [] };
  if (/SELECT service, SUM\(amount\)::float8 AS amount/.test(sql)) return { rows: [] };
  if (/SELECT category, SUM\(amount\)::float8 AS amount FROM expenses/.test(sql)) return { rows: [] };
  if (/generate_series/.test(sql)) return { rows: [] };
  throw new Error(`Unexpected finance export query: ${sql}`);
}

test('finance export creates six reports and labels unsupported accounting values', async () => {
  const originalQuery = db.query;
  const files = [];
  db.query = async (sql) => financeRows(sql);

  try {
    for (const [route, request] of [
      [exportRoute, { body: { from: '2026-10-01', to: '2026-10-31' } }],
      [legacyExportRoute, { query: { section: 'income-statement', from: '2026-10-01', to: '2026-10-31' } }],
    ]) {
      let file;
      await route(request, {
        setHeader() {},
        send(buffer) { file = buffer; }
      });
      files.push(file);
    }
  } finally {
    db.query = originalQuery;
  }

  for (const file of files) {
    assert.ok(Buffer.isBuffer(file));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      'Income Statement',
      'Cash Flow',
      'Balance Sheet',
      'Accounts Receivable',
      'Transaction Ledger',
      'Inventory'
    ]);
    assert.equal(workbook.getWorksheet('Income Statement').getCell('A16').value, 'Net income');
    assert.equal(workbook.getWorksheet('Income Statement').getCell('B16').value, 800);
    assert.equal(workbook.getWorksheet('Cash Flow').getCell('H8').value, 'Not Available');
    assert.equal(workbook.getWorksheet('Cash Flow').getCell('H12').value, 'Not Available');
    assert.equal(workbook.getWorksheet('Balance Sheet').getCell('B19').value, 'Not recorded');
    assert.equal(workbook.getWorksheet('Accounts Receivable').getCell('H8').value, 700);
    assert.equal(workbook.getWorksheet('Inventory').getCell('F8').value, 50);
    assert.equal(workbook.getWorksheet('Inventory').getCell('F9').value, 'Not recorded');
    assert.equal(workbook.getWorksheet('Transaction Ledger').getCell('K8').value, 'posted');
    assert.ok(workbook.getWorksheet('Inventory').autoFilter);
    assert.equal(workbook.getWorksheet('Income Statement').getCell('A1').fill.fgColor.argb, 'FF17324D');
    assert.equal(workbook.getWorksheet('Income Statement').getCell('A7').fill.fgColor.argb, 'FF17324D');
    assert.equal(workbook.getWorksheet('Income Statement').getCell('A9').fill.fgColor.argb, 'FFF3F6F9');
    assert.equal(workbook.getWorksheet('Cash Flow').getCell('H8').font.color.argb, 'FF946200');
    assert.equal(workbook.getWorksheet('Inventory').getCell('H8').font.color.argb, 'FFA33131');
    assert.equal(workbook.getWorksheet('Inventory').getCell('H8').fill.fgColor.argb, 'FFFBEAEA');
  }
});
