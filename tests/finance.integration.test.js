const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { after, before, describe, it } = require('node:test');
const dotenv = require('dotenv');
const express = require('express');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const tracked = {
  appointmentIds: [],
  closingIds: [],
  expenseIds: [],
  paymentIds: [],
  productIds: [],
  serviceIds: [],
  userIds: [],
};

let db;
let server;
let baseUrl;
let financeUserId;
let adminUserId;
let clientUserId;
let serviceId;
let productId;
let productStock;
let businessDate;
let saleRequestKey;
let expectedAtClose;

function approvedDatabaseConfig() {
  const databaseName = process.env.FINANCE_IT_DB_NAME?.trim();
  const approvalDatabase = process.env.FINANCE_IT_APPROVED_DATABASE?.trim();
  const environment = process.env.FINANCE_IT_ENVIRONMENT;
  const approval = process.env.FINANCE_IT_APPROVAL;
  const required = [
    'FINANCE_IT_DB_HOST',
    'FINANCE_IT_DB_PORT',
    'FINANCE_IT_DB_USER',
    'FINANCE_IT_DB_PASSWORD',
  ];

  if (process.env.NODE_ENV !== 'test'
    || environment !== 'disposable'
    || !databaseName
    || approvalDatabase !== databaseName
    || approval !== `I_APPROVE_WRITES_TO:${databaseName}`) {
    throw new Error(
      'Finance integration tests require NODE_ENV=test, FINANCE_IT_ENVIRONMENT=disposable, '
      + 'an exact FINANCE_IT_APPROVED_DATABASE match, and explicit database-specific approval.'
    );
  }

  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Finance integration database configuration is missing: ${missing.join(', ')}.`);
  }

  const envPath = path.join(projectRoot, '.env');
  const repositoryDbName = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, 'utf8')).DB_NAME
    : undefined;
  const configuredDbNames = new Set([process.env.DB_NAME, repositoryDbName].filter(Boolean));
  if (!configuredDbNames.size) {
    throw new Error('Cannot identify the repository-configured database; refusing to connect.');
  }
  if (configuredDbNames.has(databaseName)) {
    throw new Error(
      'Finance integration tests refuse the repository-configured database. '
      + 'Use a separate, explicitly approved disposable database.'
    );
  }

  const port = Number(process.env.FINANCE_IT_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FINANCE_IT_DB_PORT must be a valid TCP port.');
  }
  if (process.env.FINANCE_IT_DB_SSL
    && !['true', 'false'].includes(process.env.FINANCE_IT_DB_SSL)) {
    throw new Error('FINANCE_IT_DB_SSL must be either true or false.');
  }

  return {
    host: process.env.FINANCE_IT_DB_HOST.trim(),
    port: String(port),
    user: process.env.FINANCE_IT_DB_USER.trim(),
    password: process.env.FINANCE_IT_DB_PASSWORD,
    database: databaseName,
    ssl: process.env.FINANCE_IT_DB_SSL || 'false',
  };
}

function manilaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function offsetDate(date, days) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return manilaDate(value);
}

async function requireIsolatedReadyDatabase() {
  const identity = await db.query(`
    SELECT current_database() AS database, current_schema() AS schema
  `);
  assert.equal(identity.rows[0].database, process.env.FINANCE_IT_DB_NAME);
  assert.equal(identity.rows[0].schema, 'public');

  const requiredTables = [
    'appointments',
    'cash_closings',
    'expenses',
    'expense_edit_history',
    'inventory_products',
    'inventory_transactions',
    'notifications',
    'payment_reversals',
    'payments',
    'product_sale_details',
    'services',
    'users',
  ];
  const tableResult = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name = ANY($1::text[])
  `, [requiredTables]);
  const presentTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !presentTables.has(name));
  assert.deepEqual(
    missingTables,
    [],
    `Required finance schema is missing: ${missingTables.join(', ')}. Apply reviewed prerequisites only to this disposable database.`
  );

  const requiredColumns = [
    ['appointments', 'appointment_date'],
    ['appointments', 'appointment_end_time'],
    ['appointments', 'appointment_id'],
    ['appointments', 'appointment_status'],
    ['appointments', 'appointment_time'],
    ['appointments', 'booked_reservation_fee'],
    ['appointments', 'booked_service_price'],
    ['appointments', 'payment_status'],
    ['appointments', 'service_id'],
    ['appointments', 'user_id'],
    ['cash_closings', 'actual_amount'],
    ['cash_closings', 'business_date'],
    ['cash_closings', 'cash_closing_id'],
    ['cash_closings', 'closed_by'],
    ['cash_closings', 'closed_at'],
    ['cash_closings', 'created_at'],
    ['cash_closings', 'expected_amount'],
    ['cash_closings', 'variance'],
    ['expenses', 'amount'],
    ['expenses', 'category'],
    ['expenses', 'created_at'],
    ['expenses', 'expense_date'],
    ['expenses', 'voided_at'],
    ['expense_edit_history', 'edited_at'],
    ['expense_edit_history', 'edited_by'],
    ['expense_edit_history', 'expense_id'],
    ['expense_edit_history', 'previous_values'],
    ['expense_edit_history', 'updated_values'],
    ['inventory_products', 'category'],
    ['inventory_products', 'product_name'],
    ['inventory_products', 'product_id'],
    ['inventory_products', 'stock_quantity'],
    ['inventory_products', 'updated_at'],
    ['inventory_transactions', 'created_at'],
    ['inventory_transactions', 'new_stock'],
    ['inventory_transactions', 'product_id'],
    ['inventory_transactions', 'previous_stock'],
    ['inventory_transactions', 'product_name'],
    ['inventory_transactions', 'quantity'],
    ['inventory_transactions', 'transaction_type'],
    ['notifications', 'created_at'],
    ['notifications', 'is_read'],
    ['notifications', 'message'],
    ['notifications', 'notification_id'],
    ['notifications', 'type'],
    ['notifications', 'user_id'],
    ['payment_reversals', 'payment_id'],
    ['payment_reversals', 'reason'],
    ['payment_reversals', 'reversed_by'],
    ['payment_reversals', 'reversed_at'],
    ['payments', 'amount'],
    ['payments', 'appointment_id'],
    ['payments', 'created_at'],
    ['payments', 'method'],
    ['payments', 'note'],
    ['payments', 'payment_type'],
    ['payments', 'payment_id'],
    ['payments', 'recorded_by'],
    ['payments', 'status'],
    ['product_sale_details', 'payment_id'],
    ['product_sale_details', 'product_id'],
    ['product_sale_details', 'product_name'],
    ['product_sale_details', 'quantity'],
    ['product_sale_details', 'request_key'],
    ['product_sale_details', 'unit_price'],
    ['services', 'category'],
    ['services', 'description'],
    ['services', 'reservation_fee'],
    ['services', 'service_price'],
    ['services', 'service_name'],
    ['users', 'first_name'],
    ['users', 'last_name'],
    ['users', 'email_verified'],
    ['users', 'password_hash'],
    ['users', 'role'],
    ['users', 'status'],
    ['users', 'user_id'],
  ];
  const columnResult = await db.query(`
    SELECT req_col.table_name, req_col.column_name
    FROM unnest($1::text[], $2::text[]) AS req_col(table_name, column_name)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
      AND actual.table_name = req_col.table_name
      AND actual.column_name = req_col.column_name
    WHERE actual.column_name IS NULL
  `, [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)]);
  assert.deepEqual(
    columnResult.rows,
    [],
    `Required finance columns are missing: ${columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`).join(', ')}.`
  );

  const paymentChecks = await db.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'payments'::regclass
      AND contype = 'c'
  `);
  const checkDefinitions = paymentChecks.rows.map((row) => row.definition);
  assert.ok(checkDefinitions.some((definition) => definition.includes('reversed')),
    'Payment reversal migration is not installed.');
  assert.ok(checkDefinitions.some((definition) => definition.includes('gcash')),
    'PayMongo payment-method migration is not installed.');

  const baseline = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM appointments) AS appointments,
      (SELECT COUNT(*)::int FROM cash_closings) AS cash_closings,
      (SELECT COUNT(*)::int FROM expenses) AS expenses,
      (SELECT COUNT(*)::int FROM expense_edit_history) AS expense_edit_history,
      (SELECT COUNT(*)::int FROM notifications) AS notifications,
      (SELECT COUNT(*)::int FROM payment_reversals) AS payment_reversals,
      (SELECT COUNT(*)::int FROM payments) AS payments,
      (SELECT COUNT(*)::int FROM product_sale_details) AS product_sale_details,
      (SELECT COUNT(*)::int FROM users WHERE role IN ('admin', 'finance_officer') AND status = 'active')
        AS active_finance_recipients
  `);
  const nonEmpty = Object.entries(baseline.rows[0])
    .filter(([, count]) => Number(count) !== 0)
    .map(([name]) => name);
  assert.deepEqual(
    nonEmpty,
    [],
    `Disposable database is not empty in required scopes: ${nonEmpty.join(', ')}. Refusing to touch existing records.`
  );
}

async function createUser(role) {
  const result = await db.query(`
    INSERT INTO users (email, password_hash, first_name, last_name, role, status, email_verified)
    VALUES ($1, 'integration-test-not-a-login-hash', 'Finance', 'Integration', $2, 'active', TRUE)
    RETURNING user_id
  `, [`finance-it-${crypto.randomUUID()}@invalid.example`, role]);
  const userId = Number(result.rows[0].user_id);
  tracked.userIds.push(userId);
  return userId;
}

async function createService() {
  const result = await db.query(`
    INSERT INTO services (service_name, description, category, duration_minutes, service_price, reservation_fee, is_active)
    VALUES ($1, 'Disposable integration fixture', 'General', 60, 1000, 10, TRUE)
    RETURNING service_id
  `, [`Finance Integration ${crypto.randomUUID()}`]);
  serviceId = Number(result.rows[0].service_id);
  tracked.serviceIds.push(serviceId);
}

async function createAppointment(client, status, paymentStatus = 'paid') {
  const result = await client.query(`
    INSERT INTO appointments
      (user_id, service_id, booked_service_price, booked_reservation_fee, payment_status,
       appointment_date, appointment_time, appointment_end_time, appointment_status)
    VALUES ($1, $2, 100, 10, $3, $4::date, '10:00', '11:00', $5)
    RETURNING appointment_id
  `, [clientUserId, serviceId, paymentStatus, businessDate, status]);
  const appointmentId = Number(result.rows[0].appointment_id);
  tracked.appointmentIds.push(appointmentId);
  return appointmentId;
}

async function createPayment(client, {
  appointmentId = null,
  paymentType = 'product_sale',
  amount,
  method = 'cash',
  status = 'posted',
}) {
  const result = await client.query(`
    INSERT INTO payments
      (appointment_id, payment_type, amount, method, status, note, recorded_by, created_at)
    VALUES (
      $1, $2, $3, $4, $5, 'finance integration fixture', $6,
      (($7::date + TIME '12:00:00') AT TIME ZONE 'Asia/Manila')
    )
    RETURNING payment_id
  `, [appointmentId, paymentType, amount, method, status, financeUserId, businessDate]);
  const paymentId = Number(result.rows[0].payment_id);
  tracked.paymentIds.push(paymentId);
  return paymentId;
}

async function createBusinessFixtures() {
  const ids = await db.transaction(async (client) => {
    const refundAppointmentId = await createAppointment(client, 'cancelled');
    const reversalAppointmentId = await createAppointment(client, 'completed');
    const initialCashAppointmentId = await createAppointment(client, 'completed');
    const racingCashAppointmentId = await createAppointment(client, 'completed');
    const blockedCashAppointmentId = await createAppointment(client, 'completed');
    const nonCashAppointmentId = await createAppointment(client, 'completed');

    const includedCashId = await createPayment(client, { amount: '10.00' });
    const refundPaymentId = await createPayment(client, {
      appointmentId: refundAppointmentId,
      paymentType: 'reservation',
      amount: '20.00',
    });
    const reversalPaymentId = await createPayment(client, {
      appointmentId: reversalAppointmentId,
      paymentType: 'balance',
      amount: '30.00',
    });
    const refundedCashId = await createPayment(client, { amount: '7.00', status: 'refunded' });
    const reversedCashId = await createPayment(client, { amount: '8.00', status: 'reversed' });
    const nonCashId = await createPayment(client, { amount: '99.00', method: 'card' });

    const product = await client.query(`
      INSERT INTO inventory_products (product_name, category, stock_quantity)
      VALUES ($1, 'Finance Integration', 10)
      RETURNING product_id
    `, [`Finance Integration ${crypto.randomUUID()}`]);
    productId = Number(product.rows[0].product_id);
    tracked.productIds.push(productId);
    productStock = 10;

    return {
      refundPaymentId,
      reversalPaymentId,
      initialCashAppointmentId,
      racingCashAppointmentId,
      blockedCashAppointmentId,
      nonCashAppointmentId,
      includedCashId,
      refundedCashId,
      reversedCashId,
      nonCashId,
    };
  });
  return ids;
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {};
    const requestedId = req.get('x-finance-it-user-id');
    if (requestedId === undefined) return next();
    const userId = Number(requestedId);
    if (!Number.isSafeInteger(userId)
      || ![financeUserId, adminUserId, clientUserId].includes(userId)) {
      return res.status(400).json({ message: 'Unknown integration-test user.' });
    }
    req.session.userId = userId;
    return next();
  });
  app.use('/api/finance', require(path.join(projectRoot, 'routes', 'finance')));

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/finance`;
}

async function request(pathname, { userId, method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (userId !== undefined) headers['x-finance-it-user-id'] = String(userId);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, data };
}

async function cleanup() {
  if (!db) return;
  await db.transaction(async (client) => {
    if (tracked.expenseIds.length) {
      await client.query(
        'DELETE FROM expense_edit_history WHERE expense_id = ANY($1::integer[])',
        [tracked.expenseIds]
      );
      await client.query('DELETE FROM expenses WHERE expense_id = ANY($1::integer[])', [tracked.expenseIds]);
    }
    if (tracked.paymentIds.length) {
      await client.query(
        'DELETE FROM payment_reversals WHERE payment_id = ANY($1::integer[])',
        [tracked.paymentIds]
      );
      await client.query(
        'DELETE FROM product_sale_details WHERE payment_id = ANY($1::integer[])',
        [tracked.paymentIds]
      );
    }
    if (tracked.closingIds.length) {
      await client.query(
        'DELETE FROM cash_closings WHERE cash_closing_id = ANY($1::bigint[])',
        [tracked.closingIds]
      );
    }
    if (tracked.paymentIds.length) {
      await client.query('DELETE FROM payments WHERE payment_id = ANY($1::integer[])', [tracked.paymentIds]);
    }
    if (tracked.appointmentIds.length) {
      await client.query(
        'DELETE FROM appointments WHERE appointment_id = ANY($1::integer[])',
        [tracked.appointmentIds]
      );
    }
    if (tracked.productIds.length) {
      await client.query(
        'DELETE FROM inventory_transactions WHERE product_id = ANY($1::integer[])',
        [tracked.productIds]
      );
      await client.query(
        'DELETE FROM inventory_products WHERE product_id = ANY($1::integer[])',
        [tracked.productIds]
      );
    }
    if (tracked.serviceIds.length) {
      await client.query('DELETE FROM services WHERE service_id = ANY($1::integer[])', [tracked.serviceIds]);
    }
    if (tracked.userIds.length) {
      await client.query('DELETE FROM users WHERE user_id = ANY($1::integer[])', [tracked.userIds]);
    }
  });
}

describe('Finance dashboard and cash-closing integration', { concurrency: false }, () => {
  before(async () => {
    const config = approvedDatabaseConfig();
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = config.host;
    process.env.DB_PORT = config.port;
    process.env.DB_USER = config.user;
    process.env.DB_PASSWORD = config.password;
    process.env.DB_NAME = config.database;
    process.env.DB_SSL = config.ssl;

    db = require(path.join(projectRoot, 'db'));
    await requireIsolatedReadyDatabase();

    financeUserId = await createUser('finance_officer');
    adminUserId = await createUser('admin');
    clientUserId = await createUser('client');
    await createService();
    businessDate = manilaDate();
    await startTestServer();
  });

  after(async () => {
    let cleanupError;
    try {
      await cleanup();
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        if (server) {
          await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        }
      } finally {
        if (db) await db.pool.end();
      }
    }
    if (cleanupError) throw cleanupError;
  });

  it('enforces finance roles and validates empty dashboard/activity requests', async () => {
    const unauthenticated = await request('/activity');
    assert.equal(unauthenticated.status, 401);

    const forbidden = await request('/activity', { userId: clientUserId });
    assert.equal(forbidden.status, 403);

    for (const userId of [financeUserId, adminUserId]) {
      const activity = await request(`/activity?from=${businessDate}&to=${businessDate}`, { userId });
      assert.equal(activity.status, 200);
      assert.deepEqual(activity.data.rows, []);

      const trends = await request('/appointment-trends?months=1', { userId });
      assert.equal(trends.status, 200);
      assert.equal(trends.data.rows.length, 1);
      assert.equal(trends.data.rows[0].total, 0);
    }

    const history = await request('/cash-closing/history', { userId: financeUserId });
    assert.equal(history.status, 200);
    assert.equal(history.data.total, 0);

    assert.equal((await request('/activity?from=2026-02-30&to=2026-03-01', {
      userId: financeUserId,
    })).status, 400);
    assert.equal((await request(`/activity?from=${businessDate}&to=${offsetDate(businessDate, -1)}`, {
      userId: financeUserId,
    })).status, 400);
    assert.equal((await request('/activity?page=9007199254740991&limit=50', {
      userId: financeUserId,
    })).status, 400);
    assert.equal((await request('/appointment-trends?months=25', {
      userId: financeUserId,
    })).status, 400);
  });

  it('closes cash safely across concurrent writes and preserves the snapshot', async () => {
    const fixtures = await createBusinessFixtures();

    const futureClose = await request('/cash-closing', {
      method: 'POST',
      userId: financeUserId,
      body: { business_date: offsetDate(businessDate, 1), actual_amount: 100 },
    });
    assert.equal(futureClose.status, 400);

    const cashPayment = await request('/payments', {
      method: 'POST',
      userId: financeUserId,
      body: {
        appointment_id: fixtures.initialCashAppointmentId,
        payment_type: 'balance',
        amount: 2.5,
        method: 'cash',
      },
    });
    assert.equal(cashPayment.status, 201);
    tracked.paymentIds.push(Number(cashPayment.data.payment_id));

    saleRequestKey = crypto.randomUUID();
    const sale = await request('/product-sales', {
      method: 'POST',
      userId: financeUserId,
      body: {
        request_key: saleRequestKey,
        product_id: productId,
        quantity: 2,
        unit_price: 2,
        method: 'cash',
        reference_no: 'FINANCE-IT-SALE',
      },
    });
    assert.equal(sale.status, 201);
    assert.equal(sale.data.amount, 4);
    assert.equal(sale.data.stock_quantity, 8);
    tracked.paymentIds.push(Number(sale.data.payment_id));
    productStock = 8;

    const closeAndPayment = await Promise.all([
      request('/cash-closing', {
        method: 'POST',
        userId: financeUserId,
        body: { business_date: businessDate, actual_amount: 100 },
      }),
      request('/payments', {
        method: 'POST',
        userId: financeUserId,
        body: {
          appointment_id: fixtures.racingCashAppointmentId,
          payment_type: 'balance',
          amount: 1.25,
          method: 'cash',
        },
      }),
    ]);
    const [closing, concurrentPayment] = closeAndPayment;
    assert.equal(closing.status, 201);
    assert.ok([201, 409].includes(concurrentPayment.status));
    if (concurrentPayment.status === 201) {
      tracked.paymentIds.push(Number(concurrentPayment.data.payment_id));
    }

    const baseExpected = 10 + 20 + 30 + 2.5 + 4;
    expectedAtClose = baseExpected + (concurrentPayment.status === 201 ? 1.25 : 0);
    assert.equal(closing.data.closing.expected_amount, expectedAtClose);
    assert.equal(closing.data.closing.actual_amount, 100);
    assert.equal(closing.data.closing.variance, 100 - expectedAtClose);
    assert.equal(closing.data.closing.closed_by, financeUserId);
    tracked.closingIds.push(String(closing.data.closing.cash_closing_id));

    const duplicateClose = await request('/cash-closing', {
      method: 'POST',
      userId: financeUserId,
      body: { business_date: businessDate, actual_amount: 0 },
    });
    assert.equal(duplicateClose.status, 409);

    const paymentCountBeforeRejections = await db.query(
      'SELECT COUNT(*)::int AS count FROM payments WHERE recorded_by = $1',
      [financeUserId]
    );
    const blockedCashPayment = await request('/payments', {
      method: 'POST',
      userId: financeUserId,
      body: {
        appointment_id: fixtures.blockedCashAppointmentId,
        payment_type: 'balance',
        amount: 1,
        method: 'cash',
      },
    });
    assert.equal(blockedCashPayment.status, 409);

    const blockedCashSale = await request('/product-sales', {
      method: 'POST',
      userId: financeUserId,
      body: {
        request_key: crypto.randomUUID(),
        product_id: productId,
        quantity: 1,
        unit_price: 2,
        method: 'cash',
      },
    });
    assert.equal(blockedCashSale.status, 409);
    const paymentCountAfterRejections = await db.query(
      'SELECT COUNT(*)::int AS count FROM payments WHERE recorded_by = $1',
      [financeUserId]
    );
    assert.equal(paymentCountAfterRejections.rows[0].count, paymentCountBeforeRejections.rows[0].count);

    const closeNotices = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE user_id = $1 AND type = 'finance_cash_closing_discrepancy'
    `, [adminUserId]);
    assert.equal(closeNotices.rows[0].count, 1);

    const replay = await request('/product-sales', {
      method: 'POST',
      userId: financeUserId,
      body: {
        request_key: saleRequestKey,
        product_id: productId,
        quantity: 2,
        unit_price: 2,
        method: 'cash',
        reference_no: 'FINANCE-IT-SALE',
      },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.payment_id, sale.data.payment_id);
    const saleCount = await db.query(
      'SELECT COUNT(*)::int AS count FROM product_sale_details WHERE request_key = $1::uuid',
      [saleRequestKey]
    );
    assert.equal(saleCount.rows[0].count, 1);

    const nonCashPayment = await request('/payments', {
      method: 'POST',
      userId: financeUserId,
      body: {
        appointment_id: fixtures.nonCashAppointmentId,
        payment_type: 'balance',
        amount: 1,
        method: 'gcash',
      },
    });
    assert.equal(nonCashPayment.status, 201);
    tracked.paymentIds.push(Number(nonCashPayment.data.payment_id));

    const refund = await request(`/payments/${fixtures.refundPaymentId}/refund`, {
      method: 'POST',
      userId: financeUserId,
      body: { note: 'Finance integration cash refund' },
    });
    assert.equal(refund.status, 200);
    assert.equal(refund.data.status, 'refunded');
    assert.match(refund.data.note, /Finance integration cash refund/);
    assert.equal((await request(`/payments/${fixtures.refundPaymentId}/refund`, {
      method: 'POST',
      userId: financeUserId,
      body: { note: 'duplicate refund' },
    })).status, 409);

    const reversal = await request(`/payments/${fixtures.reversalPaymentId}/reverse`, {
      method: 'POST',
      userId: financeUserId,
      body: { reason: 'Finance integration cash reversal' },
    });
    assert.equal(reversal.status, 200);
    assert.equal(reversal.data.status, 'reversed');
    assert.equal(reversal.data.reason, 'Finance integration cash reversal');
    assert.equal((await request(`/payments/${fixtures.reversalPaymentId}/reverse`, {
      method: 'POST',
      userId: financeUserId,
      body: { reason: 'duplicate reversal' },
    })).status, 409);

    const productState = await db.query(
      'SELECT stock_quantity FROM inventory_products WHERE product_id = $1',
      [productId]
    );
    assert.equal(Number(productState.rows[0].stock_quantity), productStock);
    assert.equal(productStock, 8);

    const closingView = await request(`/cash-closing?date=${businessDate}`, { userId: financeUserId });
    assert.equal(closingView.status, 200);
    assert.equal(closingView.data.closing.expected_amount, expectedAtClose);

    const history = await request('/cash-closing/history', { userId: financeUserId });
    assert.equal(history.status, 200);
    assert.equal(history.data.total, 1);
    assert.equal(history.data.rows[0].business_date, businessDate);

    const trends = await request('/appointment-trends?months=1', { userId: financeUserId });
    assert.equal(trends.status, 200);
    assert.ok(trends.data.rows[0].completed > 0);
    assert.equal(trends.data.rows[0].cancelled, 1);
    assert.equal(
      trends.data.rows[0].total,
      trends.data.rows[0].confirmed
        + trends.data.rows[0].completed
        + trends.data.rows[0].cancelled
        + trends.data.rows[0].no_show
    );

    const activity = await request(`/activity?from=${businessDate}&to=${businessDate}`, {
      userId: financeUserId,
    });
    assert.equal(activity.status, 200);
    assert.ok(activity.data.rows.length > 0);
    for (const row of activity.data.rows) {
      assert.equal(Object.hasOwn(row, 'email'), false);
      assert.equal(Object.hasOwn(row, 'client'), false);
      assert.equal(Object.hasOwn(row, 'reference_no'), false);
    }
  });

  it('records before-and-after expense edit history atomically and does not audit no-op edits', async () => {
    const expenseInput = {
      expense_date: businessDate,
      category: 'Other',
      description: 'Finance integration expense audit fixture',
      amount: 123.45,
      supplier: 'Integration supplier',
      reference_no: 'FINANCE-IT-AUDIT',
    };
    const created = await request('/expenses', {
      method: 'POST',
      userId: financeUserId,
      body: expenseInput,
    });
    assert.equal(created.status, 201);
    const expenseId = Number(created.data.expense_id);
    tracked.expenseIds.push(expenseId);

    const denied = await request(`/expenses/${expenseId}/history`, { userId: clientUserId });
    assert.equal(denied.status, 403);

    const updatedInput = {
      ...expenseInput,
      amount: 234.56,
      description: 'Finance integration expense audit fixture updated',
    };
    const updated = await request(`/expenses/${expenseId}`, {
      method: 'PATCH',
      userId: financeUserId,
      body: updatedInput,
    });
    assert.equal(updated.status, 200);
    assert.equal(Number(updated.data.amount), updatedInput.amount);

    const history = await request(`/expenses/${expenseId}/history`, { userId: financeUserId });
    assert.equal(history.status, 200);
    assert.equal(history.data.rows.length, 1);
    assert.equal(history.data.rows[0].edited_by, financeUserId);
    assert.equal(history.data.rows[0].previous_values.amount, '123.45');
    assert.equal(history.data.rows[0].updated_values.amount, '234.56');
    assert.equal(
      history.data.rows[0].previous_values.description,
      expenseInput.description
    );
    assert.equal(
      history.data.rows[0].updated_values.description,
      updatedInput.description
    );
    assert.equal(Object.hasOwn(history.data.rows[0].previous_values, 'expense_id'), false);

    const unchanged = await request(`/expenses/${expenseId}`, {
      method: 'PATCH',
      userId: financeUserId,
      body: updatedInput,
    });
    assert.equal(unchanged.status, 200);
    const unchangedHistory = await request(`/expenses/${expenseId}/history`, { userId: financeUserId });
    assert.equal(unchangedHistory.data.rows.length, 1);
  });

});
