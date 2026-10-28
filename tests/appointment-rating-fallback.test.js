const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const jobs = require('../utils/notificationJobs');
const appointmentsRouter = require('../routes/appointments');

const originalQuery = db.query;
const originalDate = global.Date;

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

function calendarDaysBetween(start, end) {
  const parts = (date) => date.split('-').map(Number);
  const [startYear, startMonth, startDay] = parts(start);
  const [endYear, endMonth, endDay] = parts(end);
  return (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay))
    / (24 * 60 * 60 * 1000);
}

function createFallbackDb(appointments, ratings, manilaToday) {
  const calls = [];
  db.query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (/information_schema\.columns/.test(sql)) {
      return { rows: [{ has_demo_marker: true }] };
    }
    assert.match(sql, /INSERT INTO appointment_ratings/);
    assert.match(sql, /a\.appointment_status = 'completed'/);
    assert.match(sql, /a\.user_id IS NOT NULL/);
    assert.match(sql, /a\.aesthetician_id IS NOT NULL/);
    assert.match(sql, /a\.is_demo IS DISTINCT FROM TRUE/);
    assert.match(sql, /a\.appointment_date < \(NOW\(\) AT TIME ZONE 'Asia\/Manila'\)::date - \$1::integer/);
    assert.match(sql, /NOT EXISTS\s*\(\s*SELECT 1\s+FROM appointment_ratings existing/);
    assert.match(sql, /ON CONFLICT \(appointment_id\) DO NOTHING/);
    assert.deepEqual(values, [7]);

    for (const appointment of appointments) {
      const age = calendarDaysBetween(appointment.appointment_date, manilaToday);
      if (
        appointment.appointment_status === 'completed'
        && appointment.user_id != null
        && appointment.aesthetician_id != null
        && age > values[0]
        && appointment.is_demo !== true
        && !ratings.has(appointment.appointment_id)
      ) {
        ratings.set(appointment.appointment_id, {
          rating: 5,
          comment: null,
          is_automatic: true
        });
      }
    }
    return { rows: [] };
  };
  return calls;
}

test('fallback creates only due automatic ratings and is idempotent', async () => {
  const appointments = [
    { appointment_id: 1, appointment_date: '2026-01-03', appointment_status: 'completed', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 2, appointment_date: '2026-01-02', appointment_status: 'completed', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 3, appointment_date: '2026-01-01', appointment_status: 'completed', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 4, appointment_date: '2026-01-01', appointment_status: 'cancelled', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 5, appointment_date: '2026-01-01', appointment_status: 'in_progress', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 6, appointment_date: '2026-01-01', appointment_status: 'completed', user_id: null, aesthetician_id: 31 },
    { appointment_id: 7, appointment_date: '2026-01-01', appointment_status: 'completed', user_id: 7, aesthetician_id: null },
    { appointment_id: 8, appointment_date: '2026-01-12', appointment_status: 'completed', user_id: 7, aesthetician_id: 31 },
    { appointment_id: 10, appointment_date: '2026-01-01', appointment_status: 'completed', user_id: 7, aesthetician_id: 31, is_demo: true }
  ];
  const customerRating = { rating: 3, comment: 'Customer feedback', is_automatic: false };
  const ratings = new Map([[3, customerRating]]);
  const calls = createFallbackDb(appointments, ratings, '2026-01-10');
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await jobs.runAppointmentRatingFallback();
    await jobs.runAppointmentRatingFallback();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(calls.length, 4);
  assert.equal(ratings.get(1), undefined);
  assert.deepEqual(ratings.get(2), { rating: 5, comment: null, is_automatic: true });
  assert.equal(ratings.get(3), customerRating);
  for (const id of [4, 5, 6, 7, 8, 10]) assert.equal(ratings.has(id), false);
  assert.equal([...ratings.values()].filter((rating) => rating.is_automatic).length, 1);
});

test('fallback respects the exact 7-day boundary and becomes due after it', async () => {
  const appointments = [{
    appointment_id: 9,
    appointment_date: '2026-05-01',
    appointment_status: 'completed',
    user_id: 7,
    aesthetician_id: 31
  }];
  const ratings = new Map();
  const originalConsoleError = console.error;
  console.error = () => {};
  const originalQuery = db.query;

  try {
    createFallbackDb(appointments, ratings, '2026-05-08');
    await jobs.runAppointmentRatingFallback();
    assert.equal(ratings.has(9), false);

    createFallbackDb(appointments, ratings, '2026-05-09');
    await jobs.runAppointmentRatingFallback();
    assert.equal(ratings.get(9).rating, 5);
    assert.equal(ratings.get(9).is_automatic, true);
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }
});

test('customer rating submission remains blocked after the 7-day deadline', async () => {
  const queries = [];
  const automaticRating = { rating: 5, comment: null, is_automatic: true };
  const ratings = new Map([[22, automaticRating]]);
  db.query = async (sql) => {
    queries.push(sql);
    if (/SELECT appointment_id, user_id, aesthetician_id, service_id, appointment_status/.test(sql)) {
      return {
        rows: [{
          appointment_id: 22,
          user_id: 7,
          aesthetician_id: 31,
          service_id: 3,
          appointment_status: 'completed'
        }]
      };
    }
    if (/SELECT appointment_date::text AS appointment_date/.test(sql)) {
      return { rows: [{ appointment_date: '2026-01-05' }] };
    }
    if (/INSERT INTO appointment_ratings/.test(sql)) {
      ratings.set(22, { rating: 1, comment: 'Attempt to replace automatic rating', is_automatic: false });
    }
    return { rows: [] };
  };
  const response = responseCapture();
  try {
    await withFrozenDate('2026-01-13T00:00:00.000Z', () => routeHandler('/:id/rating', 'post')({
      params: { id: '22' },
      body: { rating: 1, comment: 'Attempt to replace automatic rating' },
      session: { userId: 7 }
    }, response));
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /within 7 days/);
  assert.equal(queries.some((sql) => /INSERT INTO appointment_ratings/.test(sql)), false);
  assert.equal(ratings.get(22), automaticRating);
});

test.after(() => {
  db.query = originalQuery;
  global.Date = originalDate;
});
