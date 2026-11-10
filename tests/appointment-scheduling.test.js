const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');
const availabilityRouter = require('../routes/availability');
const servicesRouter = require('../routes/services');
const { calculateAppointmentEtas } = require('../utils/appointmentScheduleEtas');
const { buildNotificationStates } = require('../utils/appointmentDelayNotifications');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalFetch = global.fetch;
const originalDate = global.Date;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER
};

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

function routeLayer(router, routePath, method) {
  return router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods[method]).route;
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

async function loadAvailability({
  service,
  staff,
  existingAppointments,
  now = '2026-01-04T21:00:00.000Z'
}) {
  const queries = [];
  db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    queries.push({ sql, values });
    if (/SELECT duration_minutes, buffer_minutes FROM services/.test(sql)) {
      return { rows: [service] };
    }
    if (/SELECT user_id FROM users WHERE role/.test(sql)) {
      return { rows: staff };
    }
    if (/SELECT aesthetician_id, appointment_date::text/.test(sql)) {
      return { rows: existingAppointments };
    }
    return { rows: [] };
  };

  const response = responseCapture();
  try {
    await withFrozenDate(now, () => routeLayer(availabilityRouter, '/', 'get').stack.at(-1).handle({
      session: { userId: 7 },
      query: { month: '2026-01', serviceId: '3' }
    }, response));
  } finally {
    db.query = originalQuery;
  }
  return { response, queries };
}

test('availability applies treatment plus buffer and shared aesthetician availability', async () => {
  const facial = await loadAvailability({
    service: { duration_minutes: 60, buffer_minutes: 30, category: 'facial' },
    staff: [{ user_id: 31 }],
    existingAppointments: [{
      aesthetician_id: 31,
      appointment_date: '2026-01-05',
      appointment_time: '09:00:00',
      appointment_end_time: '10:30:00'
    }]
  });
  assert.equal(facial.response.statusCode, 200);
  const todaySlots = facial.response.body['2026-0-5'];
  assert.equal(todaySlots.includes('9:30 AM'), false);
  assert.equal(todaySlots.includes('10:00 AM'), false);
  assert.equal(todaySlots.includes('10:30 AM'), true);
  assert.equal(todaySlots.includes('12:00 PM'), false);
  assert.equal(facial.queries[1].values.length, 0);
  assert.match(facial.queries[1].sql, /role = 'aesthetician'/);
  assert.match(facial.queries[2].sql, /GREATEST\(appointment_end_time, COALESCE\(adjusted_expected_end_time/);

  const nailService = await loadAvailability({
    service: { duration_minutes: 90, buffer_minutes: 30, category: 'Soft Gel Nail Extensions' },
    staff: [{ user_id: 44 }, { user_id: 45 }],
    existingAppointments: [{
      aesthetician_id: 44,
      appointment_date: '2026-01-05',
      appointment_time: '09:00:00',
      appointment_end_time: '10:30:00'
    }]
  });
  assert.equal(nailService.queries[1].values.length, 0);
  assert.match(nailService.queries[1].sql, /role = 'aesthetician'/);
  assert.ok(nailService.response.body['2026-0-5'].includes('9:00 AM'));
  assert.ok(nailService.response.body['2026-0-5'].includes('1:00 PM'));
  assert.equal(nailService.response.body['2026-0-5'].includes('5:00 PM'), false);

  const afterExtension = await loadAvailability({
    service: { duration_minutes: 60, buffer_minutes: 30, category: 'facial' },
    staff: [{ user_id: 31 }],
    existingAppointments: [{
      aesthetician_id: 31,
      appointment_date: '2026-01-05',
      appointment_time: '09:00:00',
      appointment_end_time: '11:00:00'
    }]
  });
  assert.equal(afterExtension.response.body['2026-0-5'].includes('10:30 AM'), false);
  assert.equal(afterExtension.response.body['2026-0-5'].includes('1:00 PM'), true);
});

test('same-day availability excludes starts inside three hours and includes the exact boundary', async () => {
  const result = await loadAvailability({
    service: { duration_minutes: 30, buffer_minutes: 0 },
    staff: [{ user_id: 31 }],
    existingAppointments: [],
    now: '2026-01-05T00:00:00.000Z'
  });
  const todaySlots = result.response.body['2026-0-5'];

  assert.equal(todaySlots.includes('10:30 AM'), false);
  assert.equal(todaySlots.includes('11:00 AM'), true);
});

async function runAdjustment({
  expectedEnd = '11:00',
  previousEnd = '10:30:00',
  scheduledEnd = '10:30:00',
  appointmentTime = '09:00:00',
  affected = [{ appointment_id: 6, user_id: 88, client: 'Client Eight', appointment_time: '10:30:00', appointment_date: '2026-01-05' }],
  existingLedger = null,
  emailOk = true,
  createNotification = true
} = {}) {
  const events = {
    appointmentUpdates: [],
    appointmentUpdateSql: [],
    auditEntries: [],
    ledgerInserts: [],
    ledgerUpdates: [],
    notificationsCreated: [],
    notificationsUpdated: [],
    emailRequests: [],
    adjustedAppointmentIds: [],
    advisoryLocks: [],
    adjustmentLockOrder: []
  };
  const appointment = {
    appointment_id: 5,
    appointment_date: '2026-01-05',
    appointment_time: appointmentTime,
    scheduled_end_time: scheduledEnd,
    appointment_end_time: scheduledEnd,
    previous_expected_end_time: previousEnd,
    aesthetician_id: 31,
    appointment_status: 'in_progress',
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    user_id: null,
    is_demo: false
  };
  const schedule = [appointment, ...affected.map((row) => ({
    appointment_status: 'confirmed',
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    appointment_end_time: '12:00:00',
    adjusted_expected_end_time: null,
    ...row,
    aesthetician_id: 31,
    current_manila: '2026-01-01 08:00'
  }))];
  const ledger = new Map();
  if (existingLedger) {
    ledger.set(Number(affected[0]?.appointment_id || 6), {
      ...existingLedger,
      affected_appointment_id: Number(affected[0]?.appointment_id || 6),
      source_appointment_ids: [5],
      attempt_count: Number(existingLedger.attempt_count || 0),
      next_attempt_at: 'due'
    });
  }

  process.env.NODE_ENV = 'test';
  process.env.BREVO_API_KEY = 'test-key';
  process.env.EMAIL_USER = 'test@example.test';
  global.fetch = async (url, options) => {
    events.emailRequests.push({ url, options });
    return {
      ok: emailOk,
      async text() {
        return 'email failure';
      }
    };
  };

  db.query = async (sql, values = []) => {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
    if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'client@example.test' }] };
    if (/WHERE affected_appointment_id = \$1\s+AND claimed_at = \$2::timestamptz/.test(sql)) {
      const entry = ledger.get(Number(values[0]));
      return entry?.claimed_at ? { rows: [{
        notification_id: entry.notification_id,
        expected_start_time: entry.expected_start_time,
        delay_minutes: entry.delay_minutes,
        is_delayed: entry.is_delayed
      }] } : { rows: [] };
    }
    if (/UPDATE appointment_delay_notifications/.test(sql)) {
      events.ledgerUpdates.push(values);
      const entry = ledger.get(Number(values[0]));
      if (entry) {
        entry.notification_id = values[1] || entry.notification_id;
        if (values[4]) {
          entry.notified_start_time = entry.expected_start_time;
          entry.notified_delay_minutes = entry.delay_minutes;
        }
        entry.delivery_status = values[2] ? 'sent' : values[3] ? 'failed' : values[4] ? 'sent' : 'failed';
        entry.email_status = values[5];
        entry.claimed_at = null;
      }
      return { rows: [{ affected_appointment_id: Number(values[0]) }] };
    }
    if (/FROM appointment_delay_notifications notification/.test(sql)) return { rows: [] };
    return { rows: [] };
  };

  db.transaction = async (callback) => callback({
    async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
      if (/SELECT appointment_id, appointment_date::text/.test(sql)) {
        if (/FOR UPDATE/.test(sql)) events.adjustmentLockOrder.push('appointment-row');
        return { rows: [appointment] };
      }
      if (/SELECT aesthetician_id, appointment_date::text AS appointment_date/.test(sql)) {
        const row = schedule.find((item) => Number(item.appointment_id) === Number(values[0]));
        return { rows: row ? [{ aesthetician_id: row.aesthetician_id, appointment_date: row.appointment_date }] : [] };
      }
      if (/SELECT pg_advisory_xact_lock/.test(sql)) {
        events.advisoryLocks.push(values);
        events.adjustmentLockOrder.push('staff-schedule');
        return { rows: [] };
      }
      if (/UPDATE appointments\s+SET adjusted_expected_end_time/.test(sql)) {
        events.appointmentUpdates.push(values);
        events.appointmentUpdateSql.push(sql);
        events.adjustedAppointmentIds.push(values[1]);
        appointment.adjusted_expected_end_time = values[0];
        return { rows: [] };
      }
      if (/INSERT INTO appointment_end_time_adjustments/.test(sql)) {
        events.auditEntries.push(values);
        return { rows: [] };
      }
      if (/SELECT a\.appointment_id, a\.user_id/.test(sql)) {
        return { rows: schedule };
      }
      if (/SELECT affected\.appointment_id/.test(sql)) return { rows: [] };
      if (/SELECT expected_start_time::text AS expected_start_time/.test(sql)) {
        const row = ledger.get(Number(values[0]));
        return { rows: row ? [{
          expected_start_time: row.expected_start_time,
          notified_start_time: row.notified_start_time,
          is_delayed: row.is_delayed,
          delivery_status: row.delivery_status,
          email_status: row.email_status,
          attempt_count: row.attempt_count
        }] : [] };
      }
      if (/SELECT notification_id\s+FROM appointment_delay_notifications/.test(sql)) {
        const entry = ledger.get(Number(values[0]));
        return entry?.claimed_at ? { rows: [{ notification_id: entry.notification_id }] } : { rows: [] };
      }
      if (/INSERT INTO notifications/.test(sql)) {
        events.notificationsCreated.push([values[0], 'appointment_delay', values[1]]);
        return { rows: createNotification
          ? [{ notification_id: 123, user_id: 88 }]
          : [] };
      }
      if (/UPDATE notifications/.test(sql)) {
        events.notificationsUpdated.push(values);
        return { rows: [{ notification_id: 123 }] };
      }
      if (/SET notification_id = \$1, updated_at = NOW\(\)/.test(sql)) {
        const entry = ledger.get(Number(values[1]));
        if (entry) entry.notification_id = values[0];
        return { rows: [] };
      }
      if (/INSERT INTO appointment_delay_notifications/.test(sql)) {
        const id = Number(values[0]);
        const previous = ledger.get(id);
        if (previous) events.ledgerUpdates.push(values);
        else events.ledgerInserts.push(values);
        ledger.set(id, {
          ...previous,
          affected_appointment_id: id,
          source_appointment_ids: values[1],
          expected_start_time: values[2],
          delay_minutes: values[3],
          is_delayed: values[4],
          delivery_status: values[5] ? 'pending' : previous?.delivery_status || 'pending',
          email_status: previous?.email_status || 'pending',
          notification_id: previous?.notification_id || null,
          notified_start_time: previous?.notified_start_time || null,
          notified_delay_minutes: previous?.notified_delay_minutes ?? null,
          attempt_count: values[5] ? 0 : previous?.attempt_count || 0
        });
        return { rows: [] };
      }
      if (/SELECT notification\.affected_appointment_id/.test(sql)) {
        const id = Number(values[0]);
        const entry = ledger.get(id);
        const client = schedule.find((row) => Number(row.appointment_id) === id);
        return entry && client && entry.attempt_count < 5
          && ['pending', 'failed'].includes(entry.delivery_status)
          ? { rows: [{
            ...entry,
            user_id: client.user_id,
            appointment_time: client.appointment_time,
            appointment_status: client.appointment_status
          }] }
          : { rows: [] };
      }
      if (/UPDATE appointment_delay_notifications\s+SET claimed_at = NOW\(\), attempt_count/.test(sql)) {
        const entry = ledger.get(Number(values[0]));
        if (entry) {
          entry.claimed_at = '2026-01-05 00:00:00+00';
          entry.attempt_count = values[1];
        }
        return { rows: [{ claimed_at: '2026-01-05 00:00:00+00' }] };
      }
      if (/SET notification_id = COALESCE/.test(sql)) {
        events.ledgerUpdates.push(values);
        const entry = ledger.get(Number(values[0]));
        if (entry) {
          entry.notification_id = values[1];
          if (values[4]) {
            entry.notified_start_time = entry.expected_start_time;
            entry.notified_delay_minutes = entry.delay_minutes;
          }
          entry.delivery_status = values[2] ? 'sent' : values[3] ? 'failed' : values[4] ? 'sent' : 'failed';
          entry.email_status = values[5];
          entry.claimed_at = null;
        }
        return { rows: [] };
      }
      return { rows: [] };
    }
  });

  const response = responseCapture();
  const handler = routeLayer(appointmentsRouter, '/admin/:id/expected-end', 'put').stack.at(-1).handle;
  try {
    await handler({
      params: { id: '5' },
      body: { expectedEndTime: expectedEnd },
      session: { userId: 7 }
    }, response);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { response, events };
}

test('service administration defaults new buffers to 30 minutes and accepts explicit zero buffers', async () => {
  const handler = routeLayer(servicesRouter, '/:id', 'put').stack.at(-1).handle;
  async function update(bufferMinutes) {
    let savedValues;
    db.query = async (_sql, values) => {
      savedValues = values;
      return { rows: [{ service_id: 3, buffer_minutes: values[4] }] };
    };
    const body = {
      serviceName: 'Facial',
      category: 'facial',
      description: 'Treatment',
      durationMinutes: 60,
      servicePrice: 1000,
      reservationFee: 500,
      ...(bufferMinutes === undefined ? {} : { bufferMinutes })
    };
    const response = responseCapture();
    await handler({ params: { id: '3' }, body }, response);
    return { response, savedValues };
  }

  try {
    const defaultBuffer = await update(undefined);
    assert.equal(defaultBuffer.response.statusCode, 200);
    assert.equal(defaultBuffer.savedValues[4], 30);

    const noBuffer = await update(0);
    assert.equal(noBuffer.response.statusCode, 200);
    assert.equal(noBuffer.savedValues[4], 0);

    let queryCount = 0;
    db.query = async () => {
      queryCount += 1;
      return { rows: [] };
    };
    const invalidResponse = responseCapture();
    await handler({
      params: { id: '3' },
      body: {
        serviceName: 'Facial',
        category: 'facial',
        description: 'Treatment',
        durationMinutes: 60,
        bufferMinutes: -1,
        servicePrice: 1000,
        reservationFee: 500
      }
    }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(queryCount, 0);
  } finally {
    db.query = originalQuery;
  }
});

test('only admins may adjust appointment expected end times', async () => {
  const roleGuard = routeLayer(appointmentsRouter, '/admin/:id/expected-end', 'put').stack[0].handle;
  db.query = async () => ({ rows: [{ role: 'client', status: 'active', dev_access_all: false }] });
  const response = responseCapture();
  let nextCalled = false;
  try {
    await roleGuard({
      session: { userId: 9 },
      accepts: () => false,
      originalUrl: '/api/appointments/admin/5/expected-end',
      path: '/api/appointments/admin/5/expected-end'
    }, response, () => { nextCalled = true; });
  } finally {
    db.query = originalQuery;
  }
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('expected-end adjustment validates boundaries, preserves bookings, audits changes, and notifies only affected clients', async () => {
  const invalid = await runAdjustment({ expectedEnd: '08:59' });
  assert.equal(invalid.response.statusCode, 400);
  assert.equal(invalid.events.appointmentUpdates.length, 0);

  const beforeScheduledEnd = await runAdjustment({ expectedEnd: '10:00' });
  assert.equal(beforeScheduledEnd.response.statusCode, 400);
  assert.equal(beforeScheduledEnd.events.auditEntries.length, 0);

  const adjusted = await runAdjustment();
  assert.equal(adjusted.response.statusCode, 200, JSON.stringify(adjusted.response.body));
  assert.equal(adjusted.response.body.affectedCount, 1);
  assert.deepEqual(adjusted.response.body.affectedAppointments, [{
    appointmentId: 6,
    client: 'Client Eight',
    appointmentTime: '10:30:00',
    estimatedStartTime: '11:00'
  }]);
  assert.deepEqual(adjusted.events.appointmentUpdates, [['11:00', 5]]);
  assert.match(adjusted.events.appointmentUpdateSql[0], /SET adjusted_expected_end_time = \$1/);
  assert.doesNotMatch(adjusted.events.appointmentUpdateSql[0], /appointment_status|payment_status|service_id|booked_service_price/);
  assert.deepEqual(adjusted.events.auditEntries, [[5, 7, '10:30', '11:00']]);
  assert.ok(adjusted.events.advisoryLocks.some((lock) => lock[0] === 1042026 && lock[1] === 31));
  assert.deepEqual(adjusted.events.adjustmentLockOrder.slice(0, 2), ['appointment-row', 'staff-schedule']);
  assert.deepEqual(adjusted.events.ledgerInserts, [[6, [5], '11:00', 30, true, true]]);
  assert.equal(adjusted.events.notificationsCreated.length, 1);
  assert.match(adjusted.events.notificationsCreated[0][2], /estimated appointment start time is now 11:00 AM/);
  assert.equal(adjusted.events.emailRequests.length, 1);
  assert.equal(adjusted.events.adjustedAppointmentIds.length, 1);
});

test('expected-end adjustment propagates a delayed appointment through downstream bookings', async () => {
  const result = await runAdjustment({
    expectedEnd: '11:00',
    affected: [{
      appointment_id: 6,
      user_id: 88,
      client: 'Client B',
      appointment_time: '10:30:00',
      appointment_date: '2026-01-05',
      booked_duration_minutes: 60,
      booked_buffer_minutes: 30,
      appointment_end_time: '12:00:00'
    }, {
      appointment_id: 7,
      user_id: 89,
      client: 'Client C',
      appointment_time: '12:00:00',
      appointment_date: '2026-01-05',
      booked_duration_minutes: 60,
      booked_buffer_minutes: 30,
      appointment_end_time: '13:30:00'
    }]
  });

  assert.deepEqual(result.response.body.affectedAppointments, [
    {
      appointmentId: 6,
      client: 'Client B',
      appointmentTime: '10:30:00',
      estimatedStartTime: '11:00'
    },
    {
      appointmentId: 7,
      client: 'Client C',
      appointmentTime: '12:00:00',
      estimatedStartTime: '12:30'
    }
  ]);
});

test('concurrent administrator adjustments serialize and audit the latest previous end time', async () => {
  const appointment = {
    appointment_id: 5,
    appointment_date: '2026-01-05',
    appointment_time: '09:00:00',
    appointment_end_time: '10:30:00',
    adjusted_expected_end_time: null,
    aesthetician_id: 31,
    appointment_status: 'in_progress',
    user_id: null,
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    is_demo: false,
    current_manila: '2026-01-01 08:00'
  };
  const audit = [];
  let transactionTail = Promise.resolve();
  db.query = originalQuery;
  db.transaction = async (callback) => {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({
        async query(sql, values = []) {
      if (/FROM clinic_operating_hours/.test(sql)) return { rows: require('../utils/clinicSchedule').DEFAULT_HOURS };
      if (/SELECT closure_id, closure_date::text, reason FROM clinic_closures/.test(sql)) return { rows: [] };
      if (/SELECT pg_advisory_xact_lock_shared/.test(sql)) return { rows: [] };
          if (/SELECT appointment_id, appointment_date::text/.test(sql)) {
            return { rows: [{
              ...appointment,
              scheduled_end_time: appointment.appointment_end_time,
              previous_expected_end_time: appointment.adjusted_expected_end_time || appointment.appointment_end_time
            }] };
          }
          if (/SELECT aesthetician_id, appointment_date::text AS appointment_date/.test(sql)) {
            return { rows: [{ aesthetician_id: 31, appointment_date: '2026-01-05' }] };
          }
          if (/SELECT a\.appointment_id, a\.user_id/.test(sql)) return { rows: [appointment] };
          if (/UPDATE appointments\s+SET adjusted_expected_end_time/.test(sql)) {
            appointment.adjusted_expected_end_time = values[0];
            return { rows: [] };
          }
          if (/INSERT INTO appointment_end_time_adjustments/.test(sql)) {
            audit.push(values);
            return { rows: [] };
          }
          if (/SELECT affected\.appointment_id/.test(sql)) return { rows: [] };
          if (/SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [] };
          return { rows: [] };
        }
      });
    } finally {
      release();
    }
  };

  const handler = routeLayer(appointmentsRouter, '/admin/:id/expected-end', 'put').stack.at(-1).handle;
  async function adjust(expectedEndTime) {
    const response = responseCapture();
    await handler({
      params: { id: '5' },
      body: { expectedEndTime },
      session: { userId: 7 }
    }, response);
    return response;
  }

  try {
    const results = await Promise.all([adjust('11:00'), adjust('11:30')]);
    assert.ok(results.every((result) => result.statusCode === 200));
    assert.deepEqual(audit, [
      [5, 7, '10:30', '11:00'],
      [5, 7, '11:00', '11:30']
    ]);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('repeated adjustments suppress duplicate messages and update messages only for meaningful delays', async () => {
  const unchanged = await runAdjustment({ expectedEnd: '11:00', previousEnd: '11:00:00' });
  assert.equal(unchanged.response.body.affectedCount, 0);
  assert.equal(unchanged.events.notificationsCreated.length, 0);
  assert.equal(unchanged.events.notificationsUpdated.length, 0);

  const sentLedger = {
    notification_id: 123,
    expected_start_time: '11:00:00',
    delay_minutes: 30,
    notified_start_time: '11:00:00',
    notified_delay_minutes: 30,
    is_delayed: true,
    delivery_status: 'sent',
    email_status: 'sent',
    pending_stale: false
  };
  const smallChange = await runAdjustment({
    expectedEnd: '11:02',
    previousEnd: '11:00:00',
    existingLedger: sentLedger
  });
  assert.equal(smallChange.events.notificationsCreated.length, 0);
  assert.equal(smallChange.events.notificationsUpdated.length, 0);
  assert.equal(smallChange.events.emailRequests.length, 0);

  const meaningfulChange = await runAdjustment({
    expectedEnd: '11:10',
    previousEnd: '11:00:00',
    existingLedger: sentLedger
  });
  assert.equal(meaningfulChange.events.notificationsCreated.length, 0);
  assert.equal(meaningfulChange.events.notificationsUpdated.length, 1);
  assert.match(meaningfulChange.events.notificationsUpdated[0][0], /11:10 AM/);
  assert.equal(meaningfulChange.events.emailRequests.length, 1);

  const stalePending = await runAdjustment({
    expectedEnd: '11:10',
    previousEnd: '11:00:00',
    existingLedger: {
      ...sentLedger,
      notified_start_time: null,
      notified_delay_minutes: null,
      delivery_status: 'pending',
      email_status: 'pending',
      pending_stale: true
    }
  });
  assert.equal(stalePending.events.notificationsUpdated.length, 1);
  assert.equal(stalePending.events.emailRequests.length, 1);
});

test('notification delivery failure does not roll back an audited end-time adjustment', async () => {
  const result = await runAdjustment({ createNotification: false, emailOk: false });
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.events.appointmentUpdates.length, 1);
  assert.equal(result.events.auditEntries.length, 1);
  assert.equal(result.response.body.notifications.failed, 1);
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  global.fetch = originalFetch;
});
