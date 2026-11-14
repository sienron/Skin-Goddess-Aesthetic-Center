const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');

const cancelHandler = appointmentsRouter.stack
  .find((layer) => layer.route?.path === '/:id/cancel-mine' && layer.route.methods.post)
  .route.stack.at(-1).handle;

function futureDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day + 5))
    .toISOString()
    .slice(0, 10);
}

async function invokeCancel({ ownerId = 12 } = {}) {
  const originalQuery = db.query;
  const calls = [];
  let statusCode = 200;
  let body;
  db.query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (/FROM appointments a\s+JOIN services/.test(sql)) {
      return {
        rows: [{
          appointment_id: 45,
          user_id: 12,
          aesthetician_id: 20,
          is_demo: false,
          appointment_date: futureDate(),
          appointment_time: '14:00:00',
          appointment_status: 'confirmed',
          payment_status: 'unpaid',
          service_name: 'Facial'
        }]
      };
    }
    if (/UPDATE appointments\s+SET appointment_status = 'cancelled'/.test(sql)) {
      return { rows: [{ appointment_id: 45 }] };
    }
    if (/INSERT INTO notifications/.test(sql)) {
      return { rows: [{ notification_id: 1 }] };
    }
    if (/clinic_notification_deliveries/.test(sql)) return { rows: [] };
    if (/SELECT email FROM users/.test(sql) || /SELECT user_id\s+FROM users/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`Unexpected appointment cancellation query: ${sql}`);
  };

  try {
    await cancelHandler({
      params: { id: '45' },
      session: { userId: ownerId }
    }, {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        body = value;
        return this;
      }
    });
  } finally {
    db.query = originalQuery;
  }
  return { statusCode, body, calls };
}

test('client can immediately cancel their own confirmed appointment', async () => {
  const result = await invokeCancel();

  assert.equal(result.statusCode, 200);
  assert.match(result.body.message, /cancelled successfully/i);
  const update = result.calls.find(({ sql }) => /UPDATE appointments\s+SET appointment_status = 'cancelled'/.test(sql));
  assert.deepEqual(update.values, [45, 12]);
  assert.match(update.sql, /user_id = \$2 AND appointment_status = 'confirmed'/);
});

test('client cannot cancel another user appointment', async () => {
  const result = await invokeCancel({ ownerId: 99 });

  assert.equal(result.statusCode, 403);
  assert.match(result.body.message, /your own appointments/i);
  assert.equal(result.calls.some(({ sql }) => /UPDATE appointments/.test(sql)), false);
});
