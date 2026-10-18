const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const notifications = require('../utils/notifications');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalFetch = global.fetch;
const originalNotifyUser = notifications.notifyUser;
const originalNotifyRoles = notifications.notifyRoles;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PAYMONGO_TEST_SECRET_KEY: process.env.PAYMONGO_TEST_SECRET_KEY,
  PAYMONGO_TEST_WEBHOOK_SECRET: process.env.PAYMONGO_TEST_WEBHOOK_SECRET
};
const referenceNumber = `SG${'A'.repeat(24)}`;
const checkoutSessionId = 'cs_test_recovery';
const paymentRecord = {
  reference_number: referenceNumber,
  user_id: 7,
  service_id: 3,
  appointment_date: '2099-01-01',
  appointment_time: '10:00:00',
  appointment_end_time: '11:00:00',
  service_name: 'Test service',
  service_price: '100.00',
  amount_cents: 1000,
  currency: 'PHP',
  status: 'pending',
  checkout_session_id: checkoutSessionId,
  appointment_id: null,
  livemode: false,
  payment_id: null,
  payment_method: null
};

process.env.NODE_ENV = 'development';
process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_recovery_only';
process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'whsk_recovery_only';
notifications.notifyUser = async () => {};
notifications.notifyRoles = async () => {};
const appointmentsRouter = require('../routes/appointments');
const confirmRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/paymongo/confirm' && layer.route.methods.post)
  .route.stack.at(-1).handle;

async function invokeConfirm({ initialStatus = 'pending', checkoutData, fetchFailure = false }) {
  const originalRecord = { ...paymentRecord, status: initialStatus };
  let checkoutStatus = initialStatus;
  let checkoutPaymentId = null;
  let checkoutPaymentMethod = null;
  let appointmentId = initialStatus === 'consumed' ? 42 : null;
  let appointmentInsertCount = 0;
  let transactionStarted = false;
  let statusCode = 200;
  let responseBody;
  const queries = [];

  db.query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (/SELECT reference_number, user_id/.test(sql)) {
      return { rows: [{ ...originalRecord, status: checkoutStatus, appointment_id: appointmentId }] };
    }
    if (/SELECT status, appointment_id, payment_id, payment_method/.test(sql)) {
      return {
        rows: [{
          status: checkoutStatus,
          appointment_id: appointmentId,
          payment_id: checkoutPaymentId,
          payment_method: checkoutPaymentMethod
        }]
      };
    }
    return { rows: [] };
  };
  db.transaction = async (callback) => {
    transactionStarted = true;
    return callback({
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (/SELECT status\s+FROM paymongo_checkout_sessions/.test(sql)) {
          return { rows: [{ status: checkoutStatus }] };
        }
        if (/SELECT status, appointment_id, user_id/.test(sql)) {
          return {
            rows: [{
              ...originalRecord,
              status: checkoutStatus,
              appointment_id: appointmentId,
              payment_id: checkoutPaymentId,
              payment_method: checkoutPaymentMethod
            }]
          };
        }
        if (/SELECT category FROM services/.test(sql)) return { rows: [{ category: 'Facial' }] };
        if (/SELECT u\.user_id/.test(sql)) {
          return { rows: [{ user_id: 8, first_name: 'Staff', last_name: 'Member', role: 'aesthetician' }] };
        }
        if (/INSERT INTO appointments/.test(sql)) {
          appointmentInsertCount += 1;
          appointmentId = 42;
          return {
            rows: [{
              appointment_id: appointmentId,
              appointment_status: 'confirmed',
              payment_status: 'paid',
              aesthetician_id: 8
            }]
          };
        }
        if (/UPDATE paymongo_checkout_sessions/.test(sql) && /status = 'paid'/.test(sql)) {
          checkoutStatus = 'paid';
          checkoutPaymentId = values[1];
          checkoutPaymentMethod = values[2];
        }
        if (/UPDATE paymongo_checkout_sessions/.test(sql) && /status = 'consumed'/.test(sql)) {
          checkoutStatus = 'consumed';
          appointmentId = 42;
          checkoutPaymentId = values[2];
          checkoutPaymentMethod = values[3];
        }
        return { rows: [] };
      }
    });
  };
  global.fetch = async (url, options) => {
    assert.match(String(url), /\/v2\/checkout_sessions\/cs_test_recovery$/);
    assert.match(options.headers.Authorization, /^Basic /);
    if (fetchFailure) throw new Error('Simulated PayMongo outage');
    return {
      ok: true,
      async json() {
        return { data: checkoutData };
      }
    };
  };

  try {
    await confirmRoute({
      body: { referenceNumber },
      session: { userId: 7 }
    }, {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      }
    });
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    global.fetch = originalFetch;
  }

  return { statusCode, responseBody, queries, transactionStarted, appointmentInsertCount };
}

function paidCheckout(attributes = {}) {
  return {
    id: checkoutSessionId,
    attributes: {
      status: 'paid',
      reference_number: referenceNumber,
      livemode: false,
      line_items: [{ amount: 1000, quantity: 1 }],
      payments: [{
        id: 'pay_test_recovery',
        attributes: {
          status: 'paid',
          amount: 1000,
          currency: 'PHP',
          source: { type: 'gcash' }
        }
      }],
      ...attributes
    }
  };
}

test('successful PayMongo recovery flows through the existing idempotent appointment confirmation path', async () => {
  const result = await invokeConfirm({ checkoutData: paidCheckout() });
  assert.equal(result.statusCode, 201);
  assert.equal(result.responseBody.appointment.appointment_id, 42);
  assert.equal(result.appointmentInsertCount, 1);
  assert.equal(result.queries.filter(({ sql }) => /INSERT INTO payments/.test(sql)).length, 1);

  const replay = await invokeConfirm({
    initialStatus: 'consumed',
    checkoutData: paidCheckout()
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.responseBody.appointment.appointment_id, 42);
  assert.equal(replay.transactionStarted, false);
  assert.equal(replay.appointmentInsertCount, 0);
});

test('PayMongo non-paid status leaves the checkout pending and does not create an appointment', async () => {
  const result = await invokeConfirm({
    checkoutData: paidCheckout({ status: 'active', payments: [] })
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.responseBody.pending, true);
  assert.equal(result.appointmentInsertCount, 0);
  assert.equal(result.queries.some(({ sql }) => /INSERT INTO appointments/.test(sql)), false);
});

test('PayMongo API failure leaves the checkout pending for retry', async () => {
  const result = await invokeConfirm({ checkoutData: null, fetchFailure: true });
  assert.equal(result.statusCode, 503);
  assert.equal(result.responseBody.pending, true);
  assert.equal(result.transactionStarted, false);
  assert.equal(result.appointmentInsertCount, 0);
});

test('recovery rejects a paid response with an amount mismatch', async () => {
  const result = await invokeConfirm({
    checkoutData: paidCheckout({
      line_items: [{ amount: 900, quantity: 1 }]
    })
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.responseBody.pending, true);
  assert.equal(result.appointmentInsertCount, 0);
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  global.fetch = originalFetch;
  notifications.notifyUser = originalNotifyUser;
  notifications.notifyRoles = originalNotifyRoles;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
