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

async function invokeCheckout(body, isoDate = '2026-01-04T22:00:00.000Z', serviceOverrides = {}, options = {}) {
  const queryCalls = [];
  let checkoutValues;
  let checkoutAttributes;
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
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
        buffer_minutes: 30,
        service_price: '1000.00',
        reservation_fee: '500.00',
        ...serviceOverrides
      }] };
    }
    if (/SELECT category FROM services/.test(sql)) return { rows: [{ category: 'facial' }] };
    if (/SELECT u\.user_id/.test(sql)) return { rows: [{ user_id: 31 }] };
    if (/INSERT INTO paymongo_checkout_sessions/.test(sql)) checkoutValues = values;
    return { rows: [] };
  };
  global.fetch = async (url, requestOptions) => {
    checkoutAttributes = JSON.parse(requestOptions.body).data.attributes;
    return {
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
    };
  };

  const response = responseCapture();
  const requestOrigin = options.requestOrigin || 'http://localhost:3000';
  const originUrl = new URL(requestOrigin);
  try {
    if (options.appBaseUrl) process.env.APP_BASE_URL = options.appBaseUrl;
    await withFrozenDate(isoDate, () => routeHandler('/paymongo/checkout-session', 'post')({
      body: { serviceId: 3, date: '2026-01-05', time: '9:00 AM', ...body },
      session: { userId: 7 },
      protocol: originUrl.protocol.slice(0, -1),
      get(name) {
        if (name === 'origin') return requestOrigin;
        return options.requestHost || originUrl.host;
      }
    }, response));
  } finally {
    db.query = originalQuery;
    global.fetch = originalFetch;
    if (previousAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousAppBaseUrl;
    }
  }
  return { response, queryCalls, checkoutValues, checkoutAttributes };
}

test('the shared booking rule accepts the exact three-hour boundary and exposes half-hour intervals', async () => {
  assert.equal(MIN_BOOKING_LEAD_MINUTES, 180);
  assert.ok(VALID_SLOTS.includes('5:00 PM'));
  assert.ok(VALID_SLOTS.includes('9:30 AM'));
  assert.ok(VALID_SLOTS.includes('1:30 PM'));
  assert.equal(VALID_SLOTS.includes('12:00 PM'), false);
  await withFrozenDate('2026-01-05T00:00:00.000Z', async () => {
    assert.equal(isSlotTooSoon('2026-01-05', '10:59'), true);
    assert.equal(isSlotTooSoon('2026-01-05', '11:00'), false);
    assert.equal(isSlotTooSoon('2026-01-05', '11:30'), false);
  });
});

test('the booking notice matches the backend minimum lead time', () => {
  const bookingPage = fs.readFileSync(path.join(__dirname, '..', 'UserAppointment.html'), 'utf8');
  const bookingScript = fs.readFileSync(path.join(__dirname, '..', 'appointment-booking.js'), 'utf8');
  assert.match(bookingPage, /at least 3 hours in advance/i);
  assert.match(bookingScript, /const MIN_BOOKING_LEAD_MINUTES = 3 \* 60;/);
  assert.match(bookingScript, /leadSeconds < MIN_BOOKING_LEAD_MINUTES \* 60/);
});

test('checkout rejects a booking inside three hours and accepts the boundary with its treatment and buffer end', async () => {
  setTestPayMongoEnvironment();
  const early = await invokeCheckout({ ...validCustomerDetails(), time: '9:00 AM' }, '2026-01-04T22:15:00.000Z');
  assert.equal(early.response.statusCode, 400);
  assert.match(early.response.body.message, /at least 3 hours/);
  assert.equal(early.checkoutValues, undefined);

  const boundary = await invokeCheckout({ ...validCustomerDetails() }, '2026-01-04T22:00:00.000Z');
  assert.equal(boundary.response.statusCode, 201, JSON.stringify(boundary.response.body));
  assert.equal(boundary.checkoutValues[5], '2026-01-05');
  assert.equal(boundary.checkoutValues[6], '09:00');
  assert.equal(boundary.checkoutValues[7], '10:30');
  assert.equal(boundary.checkoutValues[8], 60);
  assert.equal(boundary.checkoutValues[9], 30);

  const afterFour = await invokeCheckout({ ...validCustomerDetails(), time: '4:30 PM' });
  assert.equal(afterFour.response.statusCode, 201);
  assert.equal(afterFour.checkoutValues[6], '16:30');
  assert.equal(afterFour.checkoutValues[7], '18:00');
});

test('PayMongo return URLs use the same origin as the signed-in booking request', async () => {
  setTestPayMongoEnvironment();
  const result = await invokeCheckout(validCustomerDetails(), undefined, {}, {
    requestOrigin: 'https://clinic.example',
    appBaseUrl: 'https://configured.example'
  });

  assert.equal(result.response.statusCode, 201);
  assert.equal(new URL(result.checkoutAttributes.success_url).origin, 'https://clinic.example');
  assert.equal(new URL(result.checkoutAttributes.cancel_url).origin, 'https://clinic.example');
});

test('checkout rejects a request origin that does not match the current host', async () => {
  setTestPayMongoEnvironment();
  const result = await invokeCheckout(validCustomerDetails(), undefined, {}, {
    requestOrigin: 'https://clinic.example',
    requestHost: 'attacker.example'
  });

  assert.equal(result.response.statusCode, 403);
  assert.equal(result.checkoutAttributes, undefined);
});

test('checkout reserves service duration plus buffer and rejects lunch or closing overruns', async () => {
  setTestPayMongoEnvironment();
  const ninetyMinuteService = await invokeCheckout(
    { ...validCustomerDetails(), time: '9:30 AM' },
    '2026-01-04T21:00:00.000Z',
    { duration_minutes: 90 }
  );
  assert.equal(ninetyMinuteService.response.statusCode, 201);
  assert.equal(ninetyMinuteService.checkoutValues[7], '11:30');
  assert.equal(ninetyMinuteService.checkoutValues[8], 90);
  assert.equal(ninetyMinuteService.checkoutValues[9], 30);

  const threeHourAfternoon = await invokeCheckout(
    { ...validCustomerDetails(), time: '1:00 PM' },
    '2026-01-05T00:00:00.000Z',
    { duration_minutes: 180 }
  );
  assert.equal(threeHourAfternoon.response.statusCode, 201);
  assert.equal(threeHourAfternoon.checkoutValues[7], '16:30');

  const lunchOverrun = await invokeCheckout(
    { ...validCustomerDetails(), time: '11:00 AM' },
    '2026-01-05T00:00:00.000Z',
    { duration_minutes: 90 }
  );
  assert.equal(lunchOverrun.response.statusCode, 400);
  assert.match(lunchOverrun.response.body.message, /operating hours/);

  const closingOverrun = await invokeCheckout(
    { ...validCustomerDetails(), time: '3:30 PM' },
    '2026-01-05T00:00:00.000Z',
    { duration_minutes: 180 }
  );
  assert.equal(closingOverrun.response.statusCode, 400);
  assert.match(closingOverrun.response.body.message, /operating hours/);
});

test('checkout uses submitted customer details, validates them, and preserves self-booking fallback', async () => {
  setTestPayMongoEnvironment();
  const otherCustomer = await invokeCheckout(validCustomerDetails());
  assert.equal(otherCustomer.response.statusCode, 201, JSON.stringify(otherCustomer.response.body));
  assert.deepEqual(otherCustomer.checkoutValues.slice(10), [
    50000, false,
    'Jamie', 'Client', 'jamie@example.test', '+63 917 123 4567'
  ]);

  const sanitized = await invokeCheckout({ ...validCustomerDetails(), firstName: ' Jamie\u0000 ' });
  assert.equal(sanitized.response.statusCode, 201);
  assert.equal(sanitized.checkoutValues[12], 'Jamie');

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
    50000, false,
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
    appointment_time: '09:00:00',
    appointment_end_time: '10:30:00',
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    amount_cents: 50000,
    currency: 'PHP',
    status: 'paid',
    livemode: false,
    payment_id: 'pay_test'
  };
  const appointmentValues = [];
  const assignmentQueries = [];
  const staffLocks = [];
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/FROM paymongo_checkout_sessions/.test(sql)) return { rows: [payment] };
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      if (/FROM paymongo_checkout_sessions/.test(sql)) return { rows: [payment] };
      if (/SELECT category FROM services/.test(sql)) return { rows: [{ category: 'facial' }] };
      if (/SELECT user_id FROM users\s+WHERE role/.test(sql)) return { rows: [{ user_id: 31 }] };
      if (/pg_advisory_xact_lock/.test(sql)) {
        staffLocks.push(values);
        return { rows: [] };
      }
      if (/SELECT u\.user_id/.test(sql)) {
        assignmentQueries.push(sql);
        return { rows: [{ user_id: 31 }] };
      }
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
  assert.equal(appointmentValues[7], 60);
  assert.equal(appointmentValues[8], 30);
  assert.match(assignmentQueries[0], /GREATEST\(a\.appointment_end_time, COALESCE\(a\.adjusted_expected_end_time/);
  assert.match(assignmentQueries[0], /appointment_status IN \('confirmed', 'in_progress', 'completed'\)/);
  assert.deepEqual(staffLocks, [[1042026, 31]]);
  assert.deepEqual(appointmentValues.slice(-4), [
    'Jamie', 'Client', 'jamie@example.test', '+63 917 123 4567'
  ]);
});

test('ratings remain eligible on day seven and are rejected after the deadline', async () => {
  const handler = routeHandler('/:id/rating', 'post');
  async function submitAt(isoDate) {
    const queries = [];
    db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
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

test('all cancellation requests require strictly more than 24 hours, including at the server endpoint', async () => {
  const handler = routeHandler('/:id/cancellation-request', 'post');
  async function submitAt(appointmentTime, userId = 7) {
    const queries = [];
    db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
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
      if (/UPDATE appointments/.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    const response = responseCapture();
    try {
      await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
        params: { id: '42' },
        body: { reason: 'Schedule change', description: 'Please cancel this visit.' },
        session: { userId }
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

  const staffUnder24 = await submitAt('07:59', 31);
  assert.equal(staffUnder24.response.statusCode, 400);
  assert.equal(staffUnder24.queries.some((sql) => /UPDATE appointments/.test(sql)), false);
});

test('approved cancellation refunds only requests submitted more than 24 hours ahead', async () => {
  const handler = routeHandler('/:id/cancellation-request/review', 'post');
  async function review(refundEligible) {
    const queries = [];
    const transactionQueries = [];
    const refundCalls = [];
    let response;
    setTestPayMongoEnvironment();
    global.fetch = async (url) => {
      refundCalls.push(url);
      return {
        ok: true,
        async json() {
          return { data: { id: 're_test_local' } };
        }
      };
    };
    db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      queries.push({ sql, values });
      if (/SELECT a\.appointment_status, a\.service_id/.test(sql)) {
        return { rows: [{
          appointment_status: 'confirmed',
          service_id: 3,
          user_id: 7,
          aesthetician_id: 31,
          payment_status: 'paid',
          cancellation_request_status: 'pending',
          reschedule_request_status: null,
          cancellation_requested_by: 7,
          cancellation_requested_at: '2026-01-04T00:00:00.000Z',
          cancellation_refundable: refundEligible
        }] };
      }
      return { rows: [] };
    };
    db.transaction = async (callback) => callback({
      async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
        transactionQueries.push({ sql, values });
        if (/SELECT is_demo\s+FROM appointments/.test(sql)) return { rows: [{ is_demo:false }] };
        if (/SELECT reference_number, payment_id, amount_cents/.test(sql)) {
          return { rows: [{ reference_number: 'SGREFUNDTEST', payment_id: 'pay_test_local', amount_cents: 50000 }] };
        }
        if (/SELECT payment_id\s+FROM payments/.test(sql)) return { rows: [{ payment_id: 72 }] };
        if (/UPDATE payments/.test(sql)) return { rows: [{ payment_id: 72 }] };
        return { rows: [] };
      }
    });
    response = responseCapture();
    try {
      await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
        params: { id: '42' },
        body: { decision: 'allow', requestType: 'cancellation' },
        session: { userId: 99 }
      }, response));
    } finally {
      db.query = originalQuery;
      db.transaction = originalTransaction;
      global.fetch = originalFetch;
    }
    return { response, queries, transactionQueries, refundCalls };
  }

  const eligible = await review(true);
  assert.equal(eligible.response.statusCode, 200);
  assert.match(eligible.queries[0].sql, />\s*\(a\.cancellation_requested_at AT TIME ZONE 'Asia\/Manila'\) \+ INTERVAL '24 hours'/);
  assert.deepEqual(eligible.refundCalls, ['https://api.paymongo.com/v1/refunds']);
  assert.ok(eligible.transactionQueries.some(({ sql }) => /UPDATE payments\s+SET status = 'refunded'/.test(sql)));
  assert.equal(eligible.queries.some(({ sql }) => /DEPOSIT_FORFEITED/.test(sql)), false);

  const ineligible = await review(false);
  assert.equal(ineligible.response.statusCode, 200);
  assert.match(ineligible.response.body.message, /reservation fee was forfeited/i);
  assert.equal(ineligible.refundCalls.length, 0);
  assert.ok(ineligible.queries.some(({ sql, values }) => /DEPOSIT_FORFEITED/.test(sql)
    && values[0] === 7 && values[1] === '2026-01-04T00:00:00.000Z' && values[2] === 42));
});

test('direct admin cancellation forfeits a paid deposit at exactly 24 hours', async () => {
  const handler = routeHandler('/:id/cancel', 'post');
  const queries = [];
  db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    queries.push({ sql, values });
    if (/SELECT a\.appointment_id, a\.user_id/.test(sql)) {
      return { rows: [{
        appointment_id: 42,
        user_id: 7,
        aesthetician_id: 31,
        is_demo: false,
        appointment_date: '2026-01-06',
        appointment_time: '08:00:00',
        appointment_status: 'confirmed',
        payment_status: 'paid',
        service_name: 'Facial'
      }] };
    }
    return { rows: [] };
  };
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
      params: { id: '42' },
      session: { userId: 99 }
    }, response));
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /forfeited because cancellation occurred 24 hours or less/i);
  assert.ok(queries.some(({ sql }) => /DEPOSIT_FORFEITED/.test(sql)));
  assert.equal(queries.some(({ sql }) => /UPDATE paymongo_checkout_sessions/.test(sql)), false);
});

test('booking summary, terms, and cancellation forms describe the confirmed refund policy', () => {
  const policyFiles = [
    'LoginPage.html',
    'Registration.html',
    'appointment-summary.js',
    'AppointmentSummary.html',
    'MyAppointments.html',
    'AestheticianAppointmentPage.html',
    'StaffAppointmentPage.html'
  ];
  const content = policyFiles.map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  for (const text of content) assert.match(text, /more than 24 hours/i);
  assert.match(content[0], /deposits are refundable only/i);
  assert.match(content[1], /deposits are refundable only/i);
  assert.match(content[2], /deposits are refundable only/i);
  assert.match(content[4], /24 hours or less.*not refundable/i);
  assert.doesNotMatch(content[2], /reservation deposit is non-refundable/i);
});

test('rescheduling uses the original treatment and buffer snapshots without changing the booked appointment', async () => {
  const handler = routeHandler('/:id/reschedule', 'post');
  async function submit(time) {
    let updateValues;
    const queries = [];
    db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      queries.push(sql);
      if (/SELECT a\.appointment_id, a\.user_id, a\.aesthetician_id/.test(sql)) {
        return { rows: [{
          appointment_id: 42,
          user_id: 7,
          aesthetician_id: null,
          service_id: 3,
          appointment_status: 'confirmed',
          reschedule_request_status: null,
          is_demo: false,
          booked_duration_minutes: 90,
          booked_buffer_minutes: 30,
          service_name: 'Facial'
        }] };
      }
      if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: 'client' }] };
      if (/UPDATE appointments\s+SET reschedule_request_status/.test(sql)) {
        updateValues = values;
        return { rows: [] };
      }
      return { rows: [] };
    };
    const response = responseCapture();
    try {
      await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
        params: { id: '42' },
        body: {
          date: '2026-01-06',
          time,
          reason: 'Schedule change',
          description: 'Please move this appointment.'
        },
        session: { userId: 7 }
      }, response));
    } finally {
      db.query = originalQuery;
    }
    return { response, queries, updateValues };
  }

  const valid = await submit('09:30');
  assert.equal(valid.response.statusCode, 200);
  assert.equal(valid.updateValues[1], '09:30');
  assert.equal(valid.updateValues[2], '11:30');
  assert.equal(valid.queries.some((sql) => /SET appointment_date =/.test(sql)), false);

  const lunchOverrun = await submit('11:00');
  assert.equal(lunchOverrun.response.statusCode, 400);
  assert.equal(lunchOverrun.updateValues, undefined);
});

test('reschedule approval uses booked duration and buffer snapshots and rechecks the slot under lock', async () => {
  const handler = routeHandler('/:id/cancellation-request/review', 'post');
  const transactionQueries = [];
  let update;
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/SELECT a\.appointment_status, a\.service_id/.test(sql)) {
      return { rows: [{
        appointment_status: 'confirmed',
        service_id: 3,
        user_id: 7,
        aesthetician_id: 31,
        payment_status: 'paid',
        cancellation_request_status: null,
        reschedule_request_status: 'pending',
        reschedule_requested_date: '2026-01-06',
        reschedule_requested_time: '09:30:00'
      }] };
    }
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      transactionQueries.push({ sql, values });
      if (/SELECT appointment_id, appointment_status, aesthetician_id/.test(sql)) {
        return { rows: [{
          appointment_id: 42,
          appointment_status: 'confirmed',
          aesthetician_id: 31,
          booked_duration_minutes: 90,
          booked_buffer_minutes: 15,
          reschedule_request_status: 'pending',
          reschedule_requested_date: '2026-01-06',
          reschedule_requested_time: '09:30:00',
          reschedule_requested_end_time: '11:15:00'
        }] };
      }
      if (/UPDATE appointments/.test(sql)) update = { sql, values };
      return { rows: [] };
    }
  });
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
      params: { id: '42' },
      body: { decision: 'allow', requestType: 'reschedule' },
      session: { userId: 99 }
    }, response));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  const lockIndex = transactionQueries.findIndex(({ sql }) => /pg_advisory_xact_lock/.test(sql));
  const availabilityIndex = transactionQueries.findIndex(({ sql }) => /SELECT 1\s+FROM appointments/.test(sql));
  assert.ok(lockIndex >= 0);
  assert.ok(availabilityIndex > lockIndex);
  assert.deepEqual(transactionQueries[availabilityIndex].values, [31, 42, '2026-01-06', '09:30', '11:15']);
  assert.ok(update);
  assert.deepEqual(update.values, [99, 42, '2026-01-06', '09:30', '11:15']);
  assert.doesNotMatch(update.sql, /booked_duration_minutes\s*=|booked_buffer_minutes\s*=/);
  assert.equal(transactionQueries.some(({ sql }) => /FROM services/.test(sql)), false);
});

test('reschedule approval rejects a stored end time that no longer matches the booked snapshots', async () => {
  const handler = routeHandler('/:id/cancellation-request/review', 'post');
  const transactionQueries = [];
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/SELECT a\.appointment_status, a\.service_id/.test(sql)) {
      return { rows: [{
        appointment_status: 'confirmed',
        service_id: 3,
        user_id: 7,
        aesthetician_id: 31,
        payment_status: 'paid',
        cancellation_request_status: null,
        reschedule_request_status: 'pending',
        reschedule_requested_date: '2026-01-06',
        reschedule_requested_time: '09:30:00'
      }] };
    }
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      transactionQueries.push({ sql, values });
      if (/SELECT appointment_id, appointment_status, aesthetician_id/.test(sql)) {
        return { rows: [{
          appointment_id: 42,
          appointment_status: 'confirmed',
          aesthetician_id: 31,
          booked_duration_minutes: 90,
          booked_buffer_minutes: 15,
          reschedule_request_status: 'pending',
          reschedule_requested_date: '2026-01-06',
          reschedule_requested_time: '09:30:00',
          reschedule_requested_end_time: '10:30:00'
        }] };
      }
      return { rows: [] };
    }
  });
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
      params: { id: '42' },
      body: { decision: 'allow', requestType: 'reschedule' },
      session: { userId: 99 }
    }, response));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /booked duration and buffer/i);
  assert.equal(transactionQueries.some(({ sql }) => /pg_advisory_xact_lock|SELECT 1\s+FROM appointments|UPDATE appointments/.test(sql)), false);
});

test('reschedule approval rejects a slot taken before review while holding the staff schedule lock', async () => {
  const handler = routeHandler('/:id/cancellation-request/review', 'post');
  const transactionQueries = [];
  let updated = false;
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/SELECT a\.appointment_status, a\.service_id/.test(sql)) {
      return { rows: [{
        appointment_status: 'confirmed',
        service_id: 3,
        user_id: 7,
        aesthetician_id: 31,
        payment_status: 'paid',
        cancellation_request_status: null,
        reschedule_request_status: 'pending'
      }] };
    }
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      transactionQueries.push({ sql, values });
      if (/SELECT appointment_id, appointment_status, aesthetician_id/.test(sql)) {
        return { rows: [{
          appointment_id: 42,
          appointment_status: 'confirmed',
          aesthetician_id: 31,
          booked_duration_minutes: 90,
          booked_buffer_minutes: 15,
          reschedule_request_status: 'pending',
          reschedule_requested_date: '2026-01-06',
          reschedule_requested_time: '09:30:00',
          reschedule_requested_end_time: '11:15:00'
        }] };
      }
      if (/SELECT 1\s+FROM appointments/.test(sql)) return { rows: [{ exists: 1 }] };
      if (/UPDATE appointments/.test(sql)) updated = true;
      return { rows: [] };
    }
  });
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
      params: { id: '42' },
      body: { decision: 'allow', requestType: 'reschedule' },
      session: { userId: 99 }
    }, response));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  const lockIndex = transactionQueries.findIndex(({ sql }) => /pg_advisory_xact_lock/.test(sql));
  const availabilityIndex = transactionQueries.findIndex(({ sql }) => /SELECT 1\s+FROM appointments/.test(sql));
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /no longer available/i);
  assert.ok(lockIndex >= 0);
  assert.ok(availabilityIndex > lockIndex);
  assert.equal(updated, false);
});

test('admin rescheduling rejects a slot blocked by an adjusted expected end', async () => {
  const handler = routeHandler('/:id/reschedule', 'post');
  const transactionQueries = [];
  const staffLocks = [];
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/SELECT a\.appointment_id, a\.user_id, a\.aesthetician_id/.test(sql)) {
      return { rows: [{
        appointment_id: 42,
        user_id: 7,
        aesthetician_id: 31,
        service_id: 3,
        appointment_status: 'confirmed',
        reschedule_request_status: null,
        is_demo: false,
        booked_duration_minutes: 60,
        booked_buffer_minutes: 30,
        service_name: 'Facial'
      }] };
    }
    if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: 'admin' }] };
    return { rows: [] };
  };
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      transactionQueries.push({ sql, values });
      if (/SELECT appointment_status, aesthetician_id/.test(sql)) {
        return { rows: [{ appointment_status: 'confirmed', aesthetician_id: 31 }] };
      }
      if (/pg_advisory_xact_lock/.test(sql)) {
        staffLocks.push(values);
        return { rows: [] };
      }
      if (/SELECT 1\s+FROM appointments/.test(sql)) return { rows: [{ exists: 1 }] };
      return { rows: [] };
    }
  });
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-05T00:00:00.000Z', () => handler({
      params: { id: '42' },
      body: {
        date: '2026-01-05',
        time: '13:00',
        reason: 'Schedule change',
        description: 'Move away from the adjusted appointment.'
      },
      session: { userId: 99 }
    }, response));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.deepEqual(staffLocks, [[1042026, 31]]);
  assert.match(transactionQueries.find(({ sql }) => /SELECT 1\s+FROM appointments/.test(sql)).sql,
    /GREATEST\(appointment_end_time, COALESCE\(adjusted_expected_end_time/);
  assert.equal(transactionQueries.some(({ sql }) => /SET appointment_date =/.test(sql)), false);
});

test('migration scripts reference inventory, customer, and flexible scheduling migrations', () => {
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
  assert.match(packageJson.scripts.postmigrate, /046-announcement-reads\.js.*047-flexible-appointment-scheduling\.js.*048-appointment-delay-retries\.js/);
  assert.match(packageJson.scripts['migrate:appointment-scheduling'], /047-flexible-appointment-scheduling\.js.*048-appointment-delay-retries\.js/);
  assert.doesNotMatch(packageJson.scripts.migrate, /043-appointment-customer-details\.js/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', '043-appointment-customer-details.js')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', '047-flexible-appointment-scheduling.js')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', '048-appointment-delay-retries.js')), true);
});

test('customer detail migration is additive and idempotent', async () => {
  const { migrate } = require('../migrations/043-appointment-customer-details');
  const statements = [];
  db.query = async (sql) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
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

test('flexible scheduling migration backfills historical ends, adds audit tables, and can be rolled back', async () => {
  const { migrate, down } = require('../migrations/047-flexible-appointment-scheduling');
  const statements = [];
  db.transaction = async (callback) => callback({
    async query(sql) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      statements.push(sql);
      return { rows: [] };
    }
  });
  try {
    await migrate();
    assert.ok(statements.some((sql) => /SET buffer_minutes = 30/.test(sql)));
    assert.ok(statements.some((sql) => /scheduled_end_time = a\.appointment_end_time/.test(sql)));
    assert.ok(statements.some((sql) => /booked_duration_minutes = s\.duration_minutes/.test(sql)));
    assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS appointment_end_time_adjustments/.test(sql)));
    assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS appointment_delay_notifications/.test(sql)));
    assert.ok(statements.some((sql) => /appointments_adjusted_expected_end_valid/.test(sql)));

    statements.length = 0;
    await down();
    assert.ok(statements.some((sql) => /DROP TABLE IF EXISTS appointment_delay_notifications/.test(sql)));
    assert.ok(statements.some((sql) => /DROP COLUMN IF EXISTS adjusted_expected_end_time/.test(sql)));
  } finally {
    db.transaction = originalTransaction;
  }
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
