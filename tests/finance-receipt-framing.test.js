const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../db');
const financeRouter = require('../routes/finance');
const { createSecurityHeaders } = require('../middleware/securityHeaders');

test('only authenticated receipt responses permit same-origin framing', async () => {
  const originalQuery = db.query;
  const enrolledAt = new Date('2026-01-01T00:00:00Z');
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
        payment_type: 'reservation',
        amount: 200,
        method: 'cash',
        status: 'posted',
        payment_date: '2026-11-15',
        client: 'Test client',
        service_name: 'Facial',
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
    assert.match(await receipt.text(), /Test client/);

    const unauthorized = await fetch(`${url}/api/finance/payments/28/receipt`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('x-frame-options'), 'DENY');

    const other = await fetch(`${url}/other`);
    assert.equal(other.headers.get('x-frame-options'), 'DENY');
    assert.match(other.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally {
    db.query = originalQuery;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
