const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const financeRouter = require('../routes/finance');
const { createSecurityHeaders } = require('../middleware/securityHeaders');

test('only authenticated receipt responses permit same-origin framing', async () => {
  const originalQuery = db.query;
  const enrolledAt = new Date('2026-01-01T00:00:00Z');
  let paymentStatus = 'posted';
  db.query = async (sql) => {
    if (/SELECT role, status, dev_access_all/.test(sql)) {
      return { rows: [{
        role: 'finance_officer',
        status: 'active',
        totp_enabled: true,
        totp_enrolled_at: enrolledAt,
      }] };
    }
    if (/FROM payments payment/.test(sql)) {
      return { rows: [{
        payment_id: 28,
        payment_type: 'product_sale',
        amount: 200,
        method: 'cash',
        status: paymentStatus,
        payment_date: '2026-11-15',
        client: '=Test client',
        product_name: 'Cleanser',
        quantity: 2,
        unit_price: 100,
        note: 'Manual cash refund recorded: refund confirmed',
        reversal_reason: 'Incorrect payment',
        reversed_by: 7,
        reversed_at: '2026-11-15T12:00:00Z',
      }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const app = express();
  app.use(createSecurityHeaders({ production: false }));
  app.use((req, res, next) => {
    req.session = req.headers['x-test-auth'] === 'yes'
      ? {
        userId: 7,
        mfaVerifiedAt: enrolledAt.getTime(),
        privilegedMfaAuthenticatedAt: Date.now(),
      }
      : {};
    next();
  });
  app.use('/api/finance', financeRouter);
  app.get('/other', (req, res) => res.send('ok'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const receipt = await fetch(`${url}/api/finance/payments/28/receipt`, {
      headers: { 'x-test-auth': 'yes' },
    });
    assert.equal(receipt.status, 200);
    assert.match(receipt.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.match(receipt.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(receipt.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(receipt.headers.get('cache-control'), /no-store/);
    const receiptHtml = await receipt.text();
    assert.match(receiptHtml, /Test client/);
    assert.doesNotMatch(receiptHtml, /window\.print/);

    const getWorkbook = async () => {
      const response = await fetch(`${url}/api/finance/payments/28/receipt?format=xlsx`, {
        headers: { 'x-test-auth': 'yes' },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /spreadsheetml\.sheet/);
      assert.match(response.headers.get('content-disposition'), /attachment; filename="SG-RCT-2026-00000028\.xlsx"/);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const sheet = workbook.getWorksheet('Receipt');
      return label => {
        let value;
        sheet.eachRow(row => {
          if (row.getCell(1).value === label) value = row.getCell(2).value;
        });
        return value;
      };
    };

    const posted = await getWorkbook();
    assert.equal(posted('Received from'), '=Test client');
    assert.equal(posted('Quantity'), 2);
    assert.equal(posted('Unit price (PHP)'), 100);
    assert.equal(posted('Total received (PHP)'), 200);

    paymentStatus = 'reversed';
    const reversed = await getWorkbook();
    assert.match(reversed('Notice'), /not proof of a current valid payment/);
    assert.equal(reversed('Reversal reason'), 'Incorrect payment');
    assert.equal(reversed('Original payment amount (PHP)'), 200);
    assert.equal(reversed('Total received (PHP)'), undefined);

    paymentStatus = 'refunded';
    const refunded = await getWorkbook();
    assert.match(refunded('Refund audit note'), /refund confirmed/);

    const unauthorized = await fetch(`${url}/api/finance/payments/28/receipt`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('x-frame-options'), 'DENY');
    const unauthorizedExport = await fetch(`${url}/api/finance/payments/28/receipt?format=xlsx`);
    assert.equal(unauthorizedExport.status, 401);

    const other = await fetch(`${url}/other`);
    assert.equal(other.headers.get('x-frame-options'), 'DENY');
    assert.match(other.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally {
    db.query = originalQuery;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
