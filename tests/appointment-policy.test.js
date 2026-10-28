const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');
const { MIN_BOOKING_LEAD_MINUTES, VALID_SLOTS, isSlotTooSoon } = require('../utils/slots');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalFetch = global.fetch;
const originalDate = global.Date;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PAYMONGO_TEST_SECRET_KEY: process.env.PAYMONGO_TEST_SECRET_KEY,
  PAYMONGO_TEST_WEBHOOK_SECRET: process.env.PAYMONGO_TEST_WEBHOOK_SECRET,
  PAYMONGO_PAYMENT_METHODS: process.env.PAYMONGO_PAYMENT_METHODS,
  APP_BASE_URL: process.env.APP_BASE_URL
};

function routeHandler(routePath, method) {
  return appointmentsRouter.stack
    .find((layer) => layer.route?.path === routePath && layer.route.methods[method])
    .route.stack.at(-1).handle;
}

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function withFrozenDate(isoDate, callback) {
  const timestamp = originalDate.parse(isoDate);
  global.Date = class extends originalDate {
    constructor(...args) {
      super(...(args.length ? args : [timestamp]));
    }

    static now() {
      return timestamp;
    }
  };
  try {
    return await callback();
  } finally {
    global.Date = originalDate;
  }
}

function setTestPayMongoEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_local';
  process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'whsec_local';
  process.env.PAYMONGO_PAYMENT_METHODS = 'card,gcash,paymaya';
  process.env.APP_BASE_URL = 'http://localhost:3000';
}

function validCustomerDetails() {
  return {
    firstName: 'Jamie',
    lastName: 'Client',
    email: 'jamie@example.test',
    phone: '+63 917 123 4567'
  };
}

async function invokeCheckout(body) {
  const queryCalls = [];
  let checkoutValues;
  db.query = async (sql, values = []) => {
    queryCalls.push({ sql, values });
    if (/SELECT user_id, first_name, last_name, email, contact_number/.test(sql)) {
      return { rows: [{
        user_id: 7,
        first_name: 'Account',
        last_name: 'Holder',
        email: 'account@example.test',
        contact_number: '+63 917 000 0000',
        email_verified: true,
        role: 'client',
        dev_access_all: false
      }] };
    }
    if (/SELECT service_id, service_name, category, duration_minutes/.test(sql)) {
      return { rows: [{
        service_id: 3,
        service_name: 'Facial',
        category: 'facial',
        duration_minutes: 60,
        service_price: '1000.00',
        reservation_fee: '500.00'
      }] };
    }
    if (/SELECT category FROM services/.test(sql)) return { rows: [{ category: 'facial' }] };
    if (/SELECT u\.user_id/.test(sql)) return { rows: [{ user_id: 31 }] };
    if (/INSERT INTO paymongo_checkout_sessions/.test(sql)) checkoutValues = values;
    return { rows: [] };
  };
  global.fetch = async () => ({
    ok: true,
    status: 201,
    async json() {
      return {
        data: {
          id: 'cs_test_local',
          attributes: { checkout_url: 'https://checkout.paymongo.com/cs_test_local', livemode: false }
        }
      };
    }
  });

  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => routeHandler('/paymongo/checkout-session', 'post')({
      body: { serviceId: 3, date: '2026-01-05', time: '11:00 AM', ...body },
      session: { userId: 7 }
    }, response));
  } finally {
    db.query = originalQuery;
    global.fetch = originalFetch;
  }
  return { response, queryCalls, checkoutValues };
}

test('the shared booking rule accepts the exact three-hour boundary and rejects earlier slots', async () => {
  assert.equal(MIN_BOOKING_LEAD_MINUTES, 180);
  assert.ok(VALID_SLOTS.includes('5:00 PM'));
  await withFrozenDate('2026-01-05T00:00:00.000Z', async () => {
    assert.equal(isSlotTooSoon('2026-01-05', '10:59'), true);
    assert.equal(isSlotTooSoon('2026-01-05', '11:00'), false);
    assert.equal(isSlotTooSoon('2026-01-05', '1:00 PM'), false);
  });
});

test('checkout rejects a booking inside three hours and accepts the boundary and later valid slots', async () => {
  setTestPayMongoEnvironment();
  const early = await invokeCheckout({ ...validCustomerDetails(), time: '10:00 AM' });
  assert.equal(early.response.statusCode, 400);
  assert.match(early.response.body.message, /at least 3 hours/);
  assert.equal(early.checkoutValues, undefined);

  const boundary = await invokeCheckout({ ...validCustomerDetails() });
  assert.equal(boundary.response.statusCode, 201, JSON.stringify(boundary.response.body));
  assert.equal(boundary.checkoutValues[5], '2026-01-05');
  assert.equal(boundary.checkoutValues[6], '11:00');

  const afterFour = await invokeCheckout({ ...validCustomerDetails(), time: '5:00 PM' });
  assert.equal(afterFour.response.statusCode, 201);
  assert.equal(afterFour.checkoutValues[6], '17:00');
});

test('checkout uses submitted customer details, validates them, and preserves self-booking fallback', async () => {
  setTestPayMongoEnvironment();
  const otherCustomer = await invokeCheckout(validCustomerDetails());
  assert.equal(otherCustomer.response.statusCode, 201, JSON.stringify(otherCustomer.response.body));
  assert.deepEqual(otherCustomer.checkoutValues.slice(10), [
    'Jamie', 'Client', 'jamie@example.test', '+63 917 123 4567'
  ]);

  const sanitized = await invokeCheckout({ ...validCustomerDetails(), firstName: ' Jamie\u0000 ' });
  assert.equal(sanitized.response.statusCode, 201);
  assert.equal(sanitized.checkoutValues[10], 'Jamie');

  const invalid = await invokeCheckout({ ...validCustomerDetails(), email: 'not-an-email' });
  assert.equal(invalid.response.statusCode, 400);
  assert.match(invalid.response.body.message, /valid email/);
  assert.equal(invalid.checkoutValues, undefined);

  const invalidPhone = await invokeCheckout({ ...validCustomerDetails(), phone: 'extremely-long-invalid-phone-number' });
  assert.equal(invalidPhone.response.statusCode, 400);
  assert.match(invalidPhone.response.body.message, /valid phone/);
  assert.equal(invalidPhone.checkoutValues, undefined);

  const missing = await invokeCheckout({ firstName: 'Jamie' });
  assert.equal(missing.response.statusCode, 400);
  assert.equal(missing.checkoutValues, undefined);

  const selfBooking = await invokeCheckout({});
  assert.equal(selfBooking.response.statusCode, 201);
  assert.deepEqual(selfBooking.checkoutValues.slice(10), [
    'Account', 'Holder', 'account@example.test', '+63 917 000 0000'
  ]);
});

test('verified checkout creates the appointment with the submitted customer details', async () => {
  setTestPayMongoEnvironment();
  const payment = {
    reference_number: `SG${'A'.repeat(24)}`,
    user_id: 7,
    service_id: 3,
    service_name: 'Facial',
    service_price: '1000.00',
    customer_first_name: 'Jamie',
    customer_last_name: 'Client',
    customer_email: 'jamie@example.test',
    customer_phone: '+63 917 123 4567',
    appointment_date: '2026-01-06',
    appointment_time: '17:00:00',
    appointment_end_time: '18:00:00',
    amount_cents: 50000,
    currency: 'PHP',
    status: 'paid',
    livemode: false,
    payment_id: 'pay_test'
  };
  const appointmentValues = [];
  db.query = async (sql) => {
    if (/FROM paymongo_checkout_sessions/.test(sql)) return { rows: [payment] };
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM paymongo_checkout_sessions/.test(sql)) return { rows: [payment] };
      if (/SELECT category FROM services/.test(sql)) return { rows: [{ category: 'facial' }] };
      if (/SELECT u\.user_id/.test(sql)) return { rows: [{ user_id: 31 }] };
      if (/INSERT INTO appointments/.test(sql)) {
        appointmentValues.push(...values);
        return { rows: [{ appointment_id: 99, appointment_status: 'confirmed', payment_status: 'paid', aesthetician_id: 31 }] };
      }
      return { rows: [] };
    }
  });
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => routeHandler('/paymongo/confirm', 'post')({
      body: { referenceNumber: payment.reference_number },
      session: { userId: 7 }
    }, response));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 201);
  assert.ok(appointmentValues.length);
  assert.deepEqual(appointmentValues.slice(-4), [
    'Jamie', 'Client', 'jamie@example.test', '+63 917 123 4567'
  ]);
});

test('ratings remain eligible on day seven and are rejected after the deadline', async () => {
  const handler = routeHandler('/:id/rating', 'post');
  async function submitAt(isoDate) {
    const queries = [];
    db.query = async (sql) => {
      queries.push(sql);
      if (/SELECT appointment_id, user_id, aesthetician_id/.test(sql)) {
        return { rows: [{ appointment_id: 22, user_id: 7, aesthetician_id: 31, service_id: 3, appointment_status: 'completed' }] };
      }
      if (/SELECT appointment_date::text AS appointment_date/.test(sql)) return { rows: [{ appointment_date: '2026-01-05' }] };
      if (/INSERT INTO appointment_ratings/.test(sql)) return { rows: [{ rating_id: 1, rating: 5 }] };
      return { rows: [] };
    };
    const response = responseCapture();
    try {
      await withFrozenDate(isoDate, () => handler({
        params: { id: '22' },
        body: { rating: 5 },
        session: { userId: 7 }
      }, response));
    } finally {
      db.query = originalQuery;
    }
    return { response, queries };
  }

  const daySeven = await submitAt('2026-01-12T00:00:00.000Z');
  assert.equal(daySeven.response.statusCode, 201);
  assert.ok(daySeven.queries.some((sql) => /INSERT INTO appointment_ratings/.test(sql)));

  const dayEight = await submitAt('2026-01-13T00:00:00.000Z');
  assert.equal(dayEight.response.statusCode, 400);
  assert.match(dayEight.response.body.message, /within 7 days/);
  assert.equal(dayEight.queries.some((sql) => /INSERT INTO appointment_ratings/.test(sql)), false);
});

test('client cancellation requires strictly more than 24 hours, including at the server endpoint', async () => {
  const handler = routeHandler('/:id/cancellation-request', 'post');
  async function submitAt(appointmentTime) {
    const queries = [];
    db.query = async (sql) => {
      queries.push(sql);
      if (/SELECT appointment_id, aesthetician_id, user_id, appointment_status/.test(sql)) {
        return { rows: [{
          appointment_id: 42,
          aesthetician_id: 31,
          user_id: 7,
          appointment_status: 'confirmed',
          cancellation_request_status: null,
          appointment_date: '2026-01-06',
          appointment_time: `${appointmentTime}:00`
        }] };
      }
      return { rows: [] };
    };
    const response = responseCapture();
    try {
      await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
        params: { id: '42' },
        body: { reason: 'Schedule change', description: 'Please cancel this visit.' },
        session: { userId: 7 }
      }, response));
    } finally {
      db.query = originalQuery;
    }
    return { response, queries };
  }

  const under24 = await submitAt('07:59');
  assert.equal(under24.response.statusCode, 400);
  assert.equal(under24.queries.some((sql) => /UPDATE appointments/.test(sql)), false);

  const exact24 = await submitAt('08:00');
  assert.equal(exact24.response.statusCode, 400);
  assert.equal(exact24.queries.some((sql) => /UPDATE appointments/.test(sql)), false);

  const over24 = await submitAt('08:01');
  assert.equal(over24.response.statusCode, 200);
  assert.ok(over24.queries.some((sql) => /UPDATE appointments/.test(sql)));
});

test('migration scripts reference the existing inventory migration and the new customer migration', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const allScripts = Object.values(packageJson.scripts).join('\n');
  const correctMigration = '040-enable-service-inventory-suggestions.js';
  const inventoryMigrationRefs = [...allScripts.matchAll(/040-enable-(?:appointment|service)-inventory-suggestions\.js/g)]
    .map(([reference]) => reference);

  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', correctMigration)), true);
  assert.ok(inventoryMigrationRefs.length > 0);
  assert.ok(inventoryMigrationRefs.every((reference) => reference === correctMigration));
  assert.match(packageJson.scripts.migrate, /040-enable-service-inventory-suggestions\.js/);
  assert.match(packageJson.scripts.migrate, /039-appointment-inventory-mappings\.js.*040-enable-service-inventory-suggestions\.js/);
  assert.match(packageJson.scripts.postmigrate, /042-appointment-review-timezones\.js.*043-appointment-customer-details\.js/);
  assert.doesNotMatch(packageJson.scripts.migrate, /043-appointment-customer-details\.js/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', '043-appointment-customer-details.js')), true);
});

test('customer detail migration is additive and idempotent', async () => {
  const { migrate } = require('../migrations/043-appointment-customer-details');
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };
  try {
    await migrate();
  } finally {
    db.query = originalQuery;
  }
  assert.equal(statements.length, 2);
  assert.ok(statements.every((sql) => /ADD COLUMN IF NOT EXISTS/.test(sql)));
  assert.ok(statements.some((sql) => /ALTER TABLE appointments/.test(sql)));
  assert.ok(statements.some((sql) => /ALTER TABLE paymongo_checkout_sessions/.test(sql)));
});

test.after(async () => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  global.fetch = originalFetch;
  global.Date = originalDate;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db.pool.end();
});
