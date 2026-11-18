const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const db = require('../db');
const financeRouter = require('../routes/finance');

const ledgerHandler = financeRouter.stack
  .find((layer) => layer.route?.path === '/ledger' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const ledgerExportHandler = financeRouter.stack
  .find((layer) => layer.route?.path === '/ledger/export.xlsx' && layer.route.methods.get)
  .route.stack.at(-1).handle;
const cashClosingExportHandler = financeRouter.stack
  .find((layer) => layer.route?.path === '/cash-closing/export.xlsx' && layer.route.methods.get)
  .route.stack.at(-1).handle;

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

function workbookResponse() {
  const response = new PassThrough();
  const headers = {};
  const chunks = [];
  response.setHeader = (name, value) => { headers[name] = value; };
  const file = new Promise((resolve, reject) => {
    response.on('data', (chunk) => chunks.push(chunk));
    response.once('end', () => resolve(Buffer.concat(chunks)));
    response.once('error', reject);
  });
  return { response, headers, file };
}

test('finance ledger combines posted payment and recorded expense sources with traceable filters', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (/SELECT COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 2 }] };
    if (/SELECT \* FROM ledger_records/.test(sql)) {
      return { rows: [
        { transaction_id: 'PAY-10', direction: 'money_in', status: 'posted', amount: 800 },
        { transaction_id: 'EXP-12', direction: 'money_out', status: 'recorded', amount: 125 }
      ] };
    }
    throw new Error(`Unexpected ledger query: ${sql}`);
  };

  const response = responseCapture();
  try {
    await ledgerHandler({
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        direction: 'money_out',
        classification: 'suppl',
        method: 'cash',
        source: 'expenses',
        status: 'recorded',
        q: 'paper',
        page: '2',
        limit: '10'
      }
    }, response);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    rows: [
      { transaction_id: 'PAY-10', direction: 'money_in', status: 'posted', amount: 800 },
      { transaction_id: 'EXP-12', direction: 'money_out', status: 'recorded', amount: 125 }
    ],
    page: 2,
    limit: 10,
    total: 2,
    from: '2026-10-01',
    to: '2026-10-31'
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FROM payments p[\s\S]*UNION ALL[\s\S]*FROM expenses e/);
  assert.match(calls[0].sql, /LEFT JOIN payment_reversals reversal/);
  assert.match(calls[0].sql, /reversal\.reason/);
  assert.match(calls[0].sql, /TO_CHAR\(p\.created_at AT TIME ZONE 'Asia\/Manila', 'YYYY-MM-DD HH24:MI:SS\.US'\) AS transaction_at/);
  assert.match(calls[0].sql, /NULL::text AS transaction_at/);
  assert.match(calls[0].sql, /CASE WHEN e\.voided_at IS NULL THEN 'recorded' ELSE 'voided' END/);
  assert.equal((calls[0].sql.match(/FROM payments p/g) || []).length, 1);
  assert.deepEqual(calls[1].values, [
    '2026-10-01', '2026-10-31', 'money_out', 'expense', 'recorded',
    '%suppl%', '%cash%', '%paper%', 10, 10
  ]);
});

test('finance ledger rejects unsupported direction filters before querying records', async () => {
  const originalQuery = db.query;
  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    return { rows: [] };
  };
  const response = responseCapture();
  try {
    await ledgerHandler({ query: { direction: 'transfer' } }, response);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /valid transaction direction/i);
  assert.equal(queryCount, 0);
});

test('refunded and reversed payments remain traceable historical money-in rows', async () => {
  const originalQuery = db.query;
  const calls = [];
  const records = [
    {
      transaction_id: 'PAY-11',
      source_type: 'payment',
      source_id: '11',
      transaction_at: '2026-10-11 13:15:00',
      transaction_date: '2026-10-11',
      direction: 'money_in',
      counterparty: 'Client One',
      purpose: 'Service Balance Payment',
      amount: 300,
      source: 'Payments',
      destination: 'Clinic',
      classification: 'Service Income',
      payment_method: 'cash',
      reference_number: 'APT-11',
      status: 'reversed',
      recorded_by_name: 'Staff',
      details: 'Reversal: Duplicate',
    },
    {
      transaction_id: 'PAY-10',
      source_type: 'payment',
      source_id: '10',
      transaction_at: '2026-10-10 13:15:00',
      transaction_date: '2026-10-10',
      direction: 'money_in',
      counterparty: 'Client Two',
      purpose: 'Reservation Payment',
      amount: 250,
      source: 'Payments',
      destination: 'Clinic',
      classification: 'Service Income',
      payment_method: 'cash',
      reference_number: 'APT-10',
      status: 'refunded',
      recorded_by_name: 'Staff',
      details: null,
    },
  ];
  db.query = async (sql) => {
    calls.push(sql);
    if (/SELECT COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: records.length }] };
    return { rows: records };
  };

  try {
    const query = {
      from: '2026-10-01',
      to: '2026-10-31',
      direction: 'money_in',
      source: 'payments',
      status: 'all',
    };
    const displayed = responseCapture();
    await ledgerHandler({ query }, displayed);
    assert.equal(displayed.body.total, 2);
    assert.deepEqual(displayed.body.rows.map((row) => [
      row.transaction_id, row.direction, row.reference_number, row.status, row.amount,
    ]), [
      ['PAY-11', 'money_in', 'APT-11', 'reversed', 300],
      ['PAY-10', 'money_in', 'APT-10', 'refunded', 250],
    ]);

    const output = workbookResponse();
    await ledgerExportHandler({ query }, output.response);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await output.file);
    const sheet = workbook.getWorksheet('Transaction Ledger');
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.getCell('A2').value, 'PAY-11');
    assert.equal(sheet.getCell('C2').value, 'money_in');
    assert.equal(sheet.getCell('F2').value, 300);
    assert.equal(sheet.getCell('K2').value, 'APT-11');
    assert.equal(sheet.getCell('L2').value, 'reversed');
    assert.equal(sheet.getCell('A3').value, 'PAY-10');
    assert.equal(sheet.getCell('C3').value, 'money_in');
    assert.equal(sheet.getCell('K3').value, 'APT-10');
    assert.equal(sheet.getCell('L3').value, 'refunded');

    const cte = calls[0];
    assert.match(cte, /'money_in'::text AS direction/);
    assert.match(cte, /p\.reference_no::text AS reference_number/);
    assert.match(cte, /p\.status::text AS status/);
    assert.match(cte, /LEFT JOIN payment_reversals reversal ON reversal\.payment_id = p\.payment_id/);
    assert.equal((cte.match(/FROM payments p/g) || []).length, 1);
    assert.equal((cte.match(/LEFT JOIN payment_reversals reversal/g) || []).length, 1);
  } finally {
    db.query = originalQuery;
  }
});

test('transaction-ledger XLSX preserves Manila payment times and labels date-only expenses', async () => {
  const originalQuery = db.query;
  const calls = [];
  const rows = [
    {
      transaction_id: 'PAY-10',
      source_type: 'payment',
      source_id: '10',
      transaction_at: '2026-10-10 13:15:00',
      transaction_date: '2026-10-10',
      direction: 'money_in',
      counterparty: 'Client One',
      purpose: 'Reservation Payment',
      amount: 800,
      source: 'Payments',
      destination: 'Clinic',
      classification: 'Service Income',
      payment_method: 'cash',
      reference_number: 'APT-10',
      status: 'posted',
      recorded_by_name: 'Staff',
      details: null
    },
    {
      transaction_id: 'EXP-12',
      source_type: 'expense',
      source_id: '12',
      transaction_at: null,
      transaction_date: '2026-10-10',
      direction: 'money_out',
      counterparty: 'Supplier',
      purpose: 'Supplies',
      amount: 125,
      source: 'Expenses',
      destination: 'Supplier',
      classification: 'Other',
      payment_method: null,
      reference_number: null,
      status: 'voided',
      recorded_by_name: 'Admin',
      details: 'Duplicate'
    }
  ];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (/SELECT COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 1 }] };
    const source = values.includes('expense') ? 'expense' : 'payment';
    return { rows: rows.filter((row) => row.source_type === source) };
  };

  try {
    for (const [query, expected] of [
      [
        { from: '2026-10-01', to: '2026-10-31', source: 'payments', direction: 'money_in', status: 'posted' },
        { id: 'PAY-10', date: '2026-10-10 13:15:00', method: 'cash', status: 'posted' }
      ],
      [
        { from: '2026-10-01', to: '2026-10-31', source: 'expenses', direction: 'money_out', status: 'voided' },
        { id: 'EXP-12', date: '2026-10-10 (time not recorded)', method: 'Not recorded', status: 'voided' }
      ]
    ]) {
      const displayed = responseCapture();
      await ledgerHandler({ query }, displayed);
      assert.equal(displayed.body.total, 1);
      const displayedRow = displayed.body.rows[0];
      const output = workbookResponse();
      await ledgerExportHandler({ query }, output.response);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await output.file);
      const sheet = workbook.getWorksheet('Transaction Ledger');
      assert.equal(sheet.getCell('A1').value, 'Transaction ID');
      assert.equal(sheet.getCell('B1').value, 'Transaction Date / Time');
      assert.equal(sheet.getCell('A2').value, expected.id);
      assert.equal(sheet.getCell('A2').value, displayedRow.transaction_id);
      assert.equal(sheet.getCell('B2').value, expected.date);
      assert.equal(sheet.getCell('L2').value, displayedRow.status);
      assert.equal(sheet.getCell('J2').value, expected.method);
      assert.equal(sheet.getCell('L2').value, expected.status);
      assert.match(output.headers['Content-Disposition'], /finance-transaction-ledger\.xlsx/);
    }
  } finally {
    db.query = originalQuery;
  }

  assert.deepEqual(calls.filter((call) => !/SELECT COUNT/.test(call.sql)).map((call) => call.values.slice(0, 5)), [
    ['2026-10-01', '2026-10-31', 'money_in', 'payment', 'posted'],
    ['2026-10-01', '2026-10-31', 'money_in', 'payment', 'posted'],
    ['2026-10-01', '2026-10-31', 'money_out', 'expense', 'voided'],
    ['2026-10-01', '2026-10-31', 'money_out', 'expense', 'voided']
  ]);
});

test('cash-closing XLSX contains actual closing records for the selected date range', async () => {
  const originalQuery = db.query;
  let call;
  db.query = async (sql, values) => {
    call = { sql, values };
    return { rows: [{
      cash_closing_id: 7,
      business_date: '2026-10-10',
      expected_amount: 850,
      actual_amount: 800,
      variance: -50,
      closed_at: '2026-10-10 18:30:00',
      closed_by_name: 'Admin'
    }] };
  };

  try {
    const output = workbookResponse();
    await cashClosingExportHandler({
      query: { from: '2026-10-01', to: '2026-10-31' }
    }, output.response);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await output.file);
    const sheet = workbook.getWorksheet('Cash Closings');
    assert.equal(sheet.getCell('A2').value, 7);
    assert.equal(sheet.getCell('B2').value, '2026-10-10');
    assert.equal(sheet.getCell('C2').value, 850);
    assert.equal(sheet.getCell('D2').value, 800);
    assert.equal(sheet.getCell('E2').value, -50);
    assert.equal(sheet.getCell('G2').value, 'Admin');
    assert.match(output.headers['Content-Disposition'], /finance-cash-closings\.xlsx/);
    assert.match(call.sql, /FROM cash_closings cc/);
    assert.deepEqual(call.values, ['2026-10-01', '2026-10-31']);
  } finally {
    db.query = originalQuery;
  }
});
