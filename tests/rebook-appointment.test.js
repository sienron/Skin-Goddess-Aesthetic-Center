const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');

const rebookRoute = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id/rebook' && layer.route.methods.post)
  .route.stack.at(-1).handle;

function futureDate(daysAhead = 10) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day + daysAhead))
    .toISOString()
    .slice(0, 10);
}

async function invokeRebook({ staffAvailable = true, originalStatus = 'cancelled', isDemo = false } = {}) {
  const originalTransaction = db.transaction;
  const queryCalls = [];
  let statusCode = 200;
  let responseBody;
  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      queryCalls.push({ sql, values });
      if (/SELECT appointment_id, user_id, walk_in_name/.test(sql)) {
        return { rows: [{
          appointment_id: 14,
          user_id: 7,
          walk_in_name: null,
          service_id: 22,
          booked_service_price: '900.00',
          booked_reservation_fee: '300.00',
          appointment_status: originalStatus,
          is_demo: isDemo
        }] };
      }
      if (/FROM services WHERE service_id = \$1 AND is_active = TRUE/.test(sql)) {
        return { rows: [{
          service_id: 22,
          service_name: 'Facial',
          category: 'facial',
          duration_minutes: 60,
          service_price: '900.00',
          reservation_fee: '300.00'
        }] };
      }
      if (/SELECT category FROM services/.test(sql)) {
        return { rows: [{ category: 'facial' }] };
      }
      if (/SELECT u\.user_id, u\.first_name/.test(sql)) {
        return { rows: staffAvailable ? [{ user_id: 31 }] : [] };
      }
      if (/INSERT INTO appointments/.test(sql)) {
        return {
          rows: [{
            appointment_id: 99,
            appointment_status: 'confirmed',
            payment_status: 'unpaid'
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  });

  try {
    await rebookRoute({
      params: { id: '14' },
      body: { date: futureDate(), time: '11:00 AM', staffId: '31' }
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
    db.transaction = originalTransaction;
  }
  return { statusCode, responseBody, queryCalls };
}

test('rebooking preserves client, service, and booked prices without changing payment history', async () => {
  const result = await invokeRebook();
  const insert = result.queryCalls.find(({ sql }) => /INSERT INTO appointments/.test(sql));

  assert.equal(result.statusCode, 201);
  assert.equal(result.responseBody.appointment.appointment_id, 99);
  assert.match(result.responseBody.message, /original appointment and its payment history were not changed/);
  assert.deepEqual(insert.values, [
    7, null, 22, '900.00', '300.00',
    futureDate(), '11:00', '12:00', 31
  ]);
  assert.equal(result.queryCalls.some(({ sql }) => /INSERT INTO payments|UPDATE appointments/.test(sql)), false);
});

test('rebooking refuses a staff slot that is no longer available', async () => {
  const result = await invokeRebook({ staffAvailable: false });

  assert.equal(result.statusCode, 409);
  assert.match(result.responseBody.message, /not available/);
  assert.equal(result.queryCalls.some(({ sql }) => /INSERT INTO appointments/.test(sql)), false);
});

test('rebooking does not change an appointment that is still active', async () => {
  const result = await invokeRebook({ originalStatus: 'confirmed' });

  assert.equal(result.statusCode, 400);
  assert.match(result.responseBody.message, /Only completed, cancelled, or no-show appointments/);
  assert.equal(result.queryCalls.some(({ sql }) => /INSERT INTO appointments/.test(sql)), false);
});

test('rebooking rejects synthetic survey appointments before loading a schedule or creating a booking', async () => {
  const result = await invokeRebook({ isDemo: true });

  assert.equal(result.statusCode, 409);
  assert.match(result.responseBody.message, /Synthetic survey appointments cannot be rebooked/);
  assert.equal(result.queryCalls.length, 1);
  assert.equal(result.queryCalls.some(({ sql }) => /INSERT INTO appointments/.test(sql)), false);
});
