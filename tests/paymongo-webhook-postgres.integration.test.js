const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { Client } = require('pg');

const webhookSecret = 'whsk_local_postgres_integration_only';
const testId = randomBytes(6).toString('hex');
const checkoutReferences = [];
const triggerCleanups = [];
let db;
let notifications;
let originalNotifyUser;
let originalNotifyRoles;
let clientUserId;
let serviceId;
let webhookRoute;
let triggerSequence = 0;

function assertDisposableConfiguration() {
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  const database = String(process.env.DB_NAME || '').trim();
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host));
  assert.match(database, /^sg_paymongo_it_[a-z0-9_]+$/i);
  assert.notEqual(database, 'skin_goddess_db_v3');
  assert.equal(process.env.DB_USER, 'sg_paymongo_it');
  assert.equal(process.env.DB_SSL, 'false');
  assert.equal(
    process.env.PAYMONGO_IT_APPROVAL,
    `I_APPROVE_WRITES_TO:${database}`,
  );
  assert.ok(process.env.DB_PASSWORD);
}

async function assertDatabaseIdentity(client) {
  const identity = (await client.query(`
    SELECT current_database() AS database, current_user AS role,
           inet_server_addr()::text AS server_address,
           pg_get_userbyid(d.datdba) AS database_owner
    FROM pg_database d
    WHERE d.datname = current_database()
  `)).rows[0];
  const role = (await client.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
    FROM pg_roles WHERE rolname = current_user
  `)).rows[0];
  const address = String(identity?.server_address || '').split('/')[0];

  assert.equal(identity?.database, process.env.DB_NAME);
  assert.equal(identity?.role, 'sg_paymongo_it');
  assert.equal(identity?.database_owner, 'sg_paymongo_it');
  assert.ok(['127.0.0.1', '::1'].includes(address));
  assert.equal(role?.rolcanlogin, true);
  assert.equal(role?.rolsuper, false);
  assert.equal(role?.rolcreatedb, false);
  assert.equal(role?.rolcreaterole, false);
}

function signBody(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', webhookSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest('hex');
  return { timestamp, header: `t=${timestamp},te=${signature}` };
}

function paymentEvent(checkout, overrides = {}) {
  const event = {
    data: {
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        data: {
          id: checkout.checkoutSessionId,
          attributes: {
            reference_number: checkout.referenceNumber,
            line_items: [{ amount: checkout.amountCents, quantity: 1 }],
            payments: [{
              id: checkout.paymentId,
              attributes: {
                status: 'paid',
                amount: checkout.amountCents,
                currency: 'PHP',
                source: { type: 'gcash' },
              },
            }],
          },
        },
      },
    },
  };
  Object.assign(event.data.attributes, overrides.eventAttributes || {});
  if (overrides.checkoutSessionId) {
    event.data.attributes.data.id = overrides.checkoutSessionId;
  }
  if (overrides.paymentAmount !== undefined) {
    event.data.attributes.data.attributes.payments[0].attributes.amount = overrides.paymentAmount;
  }
  return event;
}

async function invokeWebhook(event, signatureHeader) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = signatureHeader || signBody(rawBody).header;
  let statusCode = 200;
  let responseBody;
  await webhookRoute({
    body: rawBody,
    get: (name) => name.toLowerCase() === 'paymongo-signature' ? signature : undefined,
  }, {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
    sendStatus(code) {
      statusCode = code;
      return this;
    },
  });
  return { statusCode, responseBody };
}

async function createCheckout({ date, time = '10:00', amountCents = 10000 }) {
  const referenceNumber = `SG${randomBytes(12).toString('hex').toUpperCase()}`;
  const checkout = {
    referenceNumber,
    checkoutSessionId: `cs_it_${testId}_${randomBytes(5).toString('hex')}`,
    paymentId: `pay_it_${testId}_${randomBytes(5).toString('hex')}`,
    amountCents,
    date,
    time,
  };
  checkoutReferences.push(referenceNumber);
  await db.query(`
    INSERT INTO paymongo_checkout_sessions (
      reference_number, user_id, service_id, service_name, service_price,
      appointment_date, appointment_time, appointment_end_time,
      booked_duration_minutes, booked_buffer_minutes, amount_cents, currency,
      status, livemode, checkout_session_id, customer_first_name,
      customer_last_name, customer_email, customer_phone
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 60, 30, $9, 'PHP',
            'pending', FALSE, $10, 'Integration', 'Client', $11, '09170000000')
  `, [
    checkout.referenceNumber,
    clientUserId,
    serviceId,
    `PayMongo integration service ${testId}`,
    1500,
    checkout.date,
    checkout.time,
    '11:30',
    checkout.amountCents,
    checkout.checkoutSessionId,
    `paymongo-it-${testId}@example.invalid`,
  ]);
  return checkout;
}

async function checkoutState(checkout) {
  const checkoutResult = await db.query(`
    SELECT status, appointment_id, payment_id, payment_method
    FROM paymongo_checkout_sessions WHERE reference_number = $1
  `, [checkout.referenceNumber]);
  const appointmentResult = await db.query(`
    SELECT appointment_id, user_id, service_id, appointment_status, payment_status
    FROM appointments
    WHERE user_id = $1 AND service_id = $2
      AND appointment_date = $3::date AND appointment_time = $4::time
  `, [clientUserId, serviceId, checkout.date, checkout.time]);
  const paymentsResult = await db.query(`
    SELECT payment_id, appointment_id, payment_type, amount, method, reference_no, status
    FROM payments WHERE reference_no = $1
  `, [checkout.referenceNumber]);
  return {
    checkout: checkoutResult.rows[0],
    appointments: appointmentResult.rows,
    payments: paymentsResult.rows,
  };
}

async function installInsertFailure(table) {
  const suffix = `${testId}_${table}_${triggerSequence++}`;
  const functionName = `paymongo_it_fail_${suffix}`;
  const triggerName = `${functionName}_trigger`;
  const cleanup = async () => {
    await db.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.${table}`);
    await db.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  };
  triggerCleanups.push(cleanup);
  await db.query(`
    CREATE FUNCTION public.${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Injected PayMongo integration failure' USING ERRCODE = 'P0001';
    END;
    $$
  `);
  await db.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON public.${table}
    FOR EACH ROW EXECUTE FUNCTION public.${functionName}()
  `);
  return cleanup;
}

test.before(async () => {
  assertDisposableConfiguration();
  process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_local_postgres_integration_only';
  process.env.PAYMONGO_TEST_WEBHOOK_SECRET = webhookSecret;

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: false,
    connectionTimeoutMillis: 4000,
  });
  try {
    await client.connect();
    await assertDatabaseIdentity(client);
    const schema = await client.query(`
      SELECT COUNT(*)::integer AS table_count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [[
      'appointments',
      'clinic_operating_hours',
      'payments',
      'paymongo_checkout_sessions',
      'services',
      'users',
    ]]);
    assert.equal(schema.rows[0].table_count, 6);
  } finally {
    await client.end().catch(() => {});
  }

  db = require('../db');
  const appClient = await db.pool.connect();
  try {
    await assertDatabaseIdentity(appClient);
  } finally {
    appClient.release();
  }

  notifications = require('../utils/notifications');
  originalNotifyUser = notifications.notifyUser;
  originalNotifyRoles = notifications.notifyRoles;
  notifications.notifyUser = async () => {};
  notifications.notifyRoles = async () => {};

  const router = require('../routes/appointments');
  webhookRoute = router.stack
    .find((layer) => layer.route?.path === '/paymongo/webhook' && layer.route.methods.post)
    .route.stack.at(-1).handle;

  const user = await db.query(`
    INSERT INTO users (email, password_hash, first_name, last_name, email_verified, role, status)
    VALUES ($1, 'integration-test-only', 'Integration', 'Client', TRUE, 'client', 'active')
    RETURNING user_id
  `, [`paymongo-it-client-${testId}@example.invalid`]);
  clientUserId = user.rows[0].user_id;

  const service = await db.query(`
    INSERT INTO services (
      service_name, category, description, duration_minutes,
      service_price, reservation_fee, is_active
    )
    VALUES ($1, 'Integration Test', 'Disposable webhook test service', 60, 1500, 100, TRUE)
    RETURNING service_id
  `, [`PayMongo integration service ${testId}`]);
  serviceId = service.rows[0].service_id;

  const staff = await db.query(`
    SELECT user_id FROM users
    WHERE role = 'aesthetician' AND status = 'active' AND email_verified = TRUE
    LIMIT 1
  `);
  assert.ok(staff.rows.length > 0, 'The migrated disposable database needs an active aesthetician fixture.');
});

test.after(async () => {
  if (!db) return;
  try {
    for (const cleanup of triggerCleanups.reverse()) {
      await cleanup();
    }
    if (checkoutReferences.length) {
      const appointmentIds = (await db.query(`
        SELECT appointment_id
        FROM paymongo_checkout_sessions
        WHERE reference_number = ANY($1::varchar[]) AND appointment_id IS NOT NULL
      `, [checkoutReferences])).rows.map((row) => row.appointment_id);
      await db.query('DELETE FROM payments WHERE reference_no = ANY($1::varchar[])', [checkoutReferences]);
      if (appointmentIds.length) {
        await db.query(`
          UPDATE paymongo_checkout_sessions SET appointment_id = NULL
          WHERE reference_number = ANY($1::varchar[])
        `, [checkoutReferences]);
        await db.query('DELETE FROM payments WHERE appointment_id = ANY($1::integer[])', [appointmentIds]);
        await db.query('DELETE FROM appointments WHERE appointment_id = ANY($1::integer[])', [appointmentIds]);
      }
      await db.query('DELETE FROM paymongo_checkout_sessions WHERE reference_number = ANY($1::varchar[])', [checkoutReferences]);
    }
    if (serviceId) await db.query('DELETE FROM services WHERE service_id = $1', [serviceId]);
    if (clientUserId) await db.query('DELETE FROM users WHERE user_id = $1', [clientUserId]);
  } finally {
    if (notifications) {
      notifications.notifyUser = originalNotifyUser;
      notifications.notifyRoles = originalNotifyRoles;
    }
    await db.pool.end();
  }
});

test('real PostgreSQL stores one appointment and payment for successful and duplicate deliveries', async () => {
  const checkout = await createCheckout({ date: '2099-01-01' });
  const event = paymentEvent(checkout);

  assert.equal((await invokeWebhook(event)).statusCode, 200);
  let state = await checkoutState(checkout);
  assert.equal(state.checkout.status, 'consumed');
  assert.equal(state.checkout.payment_id, checkout.paymentId);
  assert.equal(state.checkout.payment_method, 'gcash');
  assert.equal(state.appointments.length, 1);
  assert.equal(state.appointments[0].user_id, clientUserId);
  assert.equal(state.appointments[0].service_id, serviceId);
  assert.equal(state.appointments[0].appointment_status, 'confirmed');
  assert.equal(state.appointments[0].payment_status, 'paid');
  assert.equal(state.checkout.appointment_id, state.appointments[0].appointment_id);
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].appointment_id, state.appointments[0].appointment_id);
  assert.equal(state.payments[0].payment_type, 'reservation');
  assert.equal(Number(state.payments[0].amount), 100);
  assert.equal(state.payments[0].method, 'gcash');
  assert.equal(state.payments[0].reference_no, checkout.referenceNumber);
  assert.equal(state.payments[0].status, 'posted');

  assert.equal((await invokeWebhook(event)).statusCode, 200);
  state = await checkoutState(checkout);
  assert.equal(state.checkout.status, 'consumed');
  assert.equal(state.appointments.length, 1);
  assert.equal(state.payments.length, 1);
});

test('real PostgreSQL leaves checkout unchanged for invalid signatures, amount, mode, or unrelated session IDs', async () => {
  const checkout = await createCheckout({ date: '2099-01-02' });
  const baseEvent = paymentEvent(checkout);
  const invalidSignature = await invokeWebhook(baseEvent, 't=invalid,te=invalid');
  assert.equal(invalidSignature.statusCode, 401);

  const incorrectAmount = paymentEvent(checkout, { paymentAmount: checkout.amountCents - 1 });
  assert.equal((await invokeWebhook(incorrectAmount)).statusCode, 400);

  const incorrectMode = paymentEvent(checkout, { eventAttributes: { livemode: true } });
  assert.equal((await invokeWebhook(incorrectMode)).statusCode, 400);

  const unrelatedSession = paymentEvent(checkout, {
    checkoutSessionId: `cs_unrelated_${testId}`,
  });
  assert.equal((await invokeWebhook(unrelatedSession)).statusCode, 200);

  const state = await checkoutState(checkout);
  assert.equal(state.checkout.status, 'pending');
  assert.equal(state.checkout.appointment_id, null);
  assert.equal(state.checkout.payment_id, null);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.payments.length, 0);
});

test('real PostgreSQL rolls back checkout when appointment creation fails', async () => {
  const checkout = await createCheckout({ date: '2099-01-03' });
  const removeTrigger = await installInsertFailure('appointments');
  try {
    assert.equal((await invokeWebhook(paymentEvent(checkout))).statusCode, 409);
  } finally {
    await removeTrigger();
  }

  const state = await checkoutState(checkout);
  assert.equal(state.checkout.status, 'pending');
  assert.equal(state.checkout.appointment_id, null);
  assert.equal(state.checkout.payment_id, null);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.payments.length, 0);
});

test('real PostgreSQL rolls back appointment and checkout when payment creation fails', async () => {
  const checkout = await createCheckout({ date: '2099-01-04' });
  const removeTrigger = await installInsertFailure('payments');
  try {
    assert.equal((await invokeWebhook(paymentEvent(checkout))).statusCode, 409);
  } finally {
    await removeTrigger();
  }

  const state = await checkoutState(checkout);
  assert.equal(state.checkout.status, 'pending');
  assert.equal(state.checkout.appointment_id, null);
  assert.equal(state.checkout.payment_id, null);
  assert.equal(state.appointments.length, 0);
  assert.equal(state.payments.length, 0);
});
