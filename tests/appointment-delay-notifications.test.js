const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const {
  MAX_DELIVERY_ATTEMPTS,
  buildNotificationStates,
  calculateAppointmentEtas,
  getDeliveryOutcome,
  processOneAppointmentDelayNotification
} = require('../utils/appointmentDelayNotifications');

const root = path.join(__dirname, '..');
const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalFetch = global.fetch;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER
};

function appointment(id, start, end, overrides = {}) {
  return {
    appointment_id: id,
    user_id: id + 100,
    client: `Client ${id}`,
    appointment_date: '2026-01-05',
    appointment_time: start,
    appointment_end_time: end,
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    appointment_status: id === 1 ? 'in_progress' : 'confirmed',
    ...overrides
  };
}

test('cascading ETA calculations propagate through a long chronological chain', () => {
  const estimates = calculateAppointmentEtas([
    appointment(1, '09:00:00', '10:30:00', { adjusted_expected_end_time: '11:00:00' }),
    appointment(2, '10:30:00', '12:00:00'),
    appointment(3, '12:00:00', '13:30:00'),
    appointment(4, '13:30:00', '15:00:00'),
    appointment(5, '15:00:00', '16:30:00')
  ]);

  assert.deepEqual(estimates.map(({ estimated_start_time }) => estimated_start_time), [
    '09:00', '11:00', '12:30', '14:00', '15:30'
  ]);
  assert.deepEqual(estimates.slice(1).map(({ source_appointment_ids }) => source_appointment_ids), [
    [1], [1], [1], [1]
  ]);
});

test('an adjusted end remains an absolute ETA when that appointment is itself delayed', () => {
  const estimates = calculateAppointmentEtas([
    appointment(1, '09:00:00', '10:30:00', { adjusted_expected_end_time: '11:00:00' }),
    appointment(2, '10:30:00', '12:00:00', { adjusted_expected_end_time: '13:00:00' }),
    appointment(3, '12:00:00', '13:30:00')
  ]);
  assert.deepEqual(estimates.map(({ estimated_start_time, estimated_end_time }) => [
    estimated_start_time,
    estimated_end_time
  ]), [
    ['09:00', '11:00'],
    ['11:00', '13:00'],
    ['13:00', '14:30']
  ]);
});

test('aggregate delay state retains another source when one ongoing delay is removed', () => {
  const schedule = [
    appointment(1, '09:00:00', '10:30:00', { adjusted_expected_end_time: '11:00:00' }),
    appointment(2, '10:30:00', '12:00:00', { adjusted_expected_end_time: '13:00:00' }),
    appointment(3, '12:00:00', '13:30:00'),
    appointment(4, '13:30:00', '15:00:00')
  ];
  const estimates = calculateAppointmentEtas(schedule).map((row) => ({
    ...row,
    is_upcoming: true
  }));
  const activeC = estimates.find((row) => row.appointment_id === 3);
  assert.equal(activeC.estimated_start_time, '13:00');
  assert.deepEqual(activeC.source_appointment_ids, [1, 2]);

  schedule[0].adjusted_expected_end_time = null;
  const afterSourceOneClears = calculateAppointmentEtas(schedule).map((row) => ({
    ...row,
    is_upcoming: true
  }));
  const states = buildNotificationStates(afterSourceOneClears, [{
    appointment_id: 3,
    user_id: 103,
    appointment_time: '12:00:00',
    is_delayed: true
  }]);
  const remainingDelay = states.find((row) => row.appointment_id === 3);
  assert.equal(remainingDelay.is_delayed, true);
  assert.deepEqual(remainingDelay.source_appointment_ids, [2]);
  assert.equal(remainingDelay.expected_start_time, '13:00');
});

test('delay delivery retry uses bounded exponential backoff and exhausts at its attempt limit', () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 5);
  assert.deepEqual([1, 2, 3, 4].map((attempt) => getDeliveryOutcome(attempt, {
    delivered: false,
    emailStatus: 'failed'
  }).nextAttemptMinutes), [1, 2, 4, 8]);
  assert.deepEqual(getDeliveryOutcome(MAX_DELIVERY_ATTEMPTS, {
    delivered: false,
    emailStatus: 'failed'
  }), {
    succeeded: false,
    exhausted: true,
    nextAttemptMinutes: null
  });
  assert.equal(getDeliveryOutcome(1, { delivered: true, emailStatus: 'sent' }).succeeded, true);
});

test('simultaneous delay workers claim a first-time client notification only once', async () => {
  const source = {
    appointment_id: 1,
    user_id: null,
    appointment_date: '2026-01-05',
    appointment_time: '09:00:00',
    appointment_end_time: '10:30:00',
    adjusted_expected_end_time: '11:00:00',
    booked_duration_minutes: 60,
    booked_buffer_minutes: 30,
    appointment_status: 'in_progress',
    current_manila: '2026-01-01 08:00'
  };
  const affected = appointment(2, '10:30:00', '12:00:00', {
    current_manila: '2026-01-01 08:00'
  });
  const ledger = {
    affected_appointment_id: 2,
    notification_id: null,
    expected_start_time: '11:00:00',
    delay_minutes: 30,
    is_delayed: true,
    notified_start_time: null,
    delivery_status: 'pending',
    email_status: 'pending',
    attempt_count: 0,
    next_attempt_at: 'due'
  };
  let claimLocked = false;
  let releaseFirstClaim;
  let firstClaimReached;
  const firstClaim = new Promise((resolve) => { firstClaimReached = resolve; });
  const holdClaim = new Promise((resolve) => { releaseFirstClaim = resolve; });
  let notificationCreates = 0;
  let claimQueries = 0;
  let claimTransactionCommitted = false;

  process.env.NODE_ENV = 'test';
  process.env.BREVO_API_KEY = 'test-key';
  process.env.EMAIL_USER = 'test@example.test';
  global.fetch = async () => ({ ok: true, async text() { return ''; } });
  db.query = async (sql, values = []) => {
    if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'client@example.test' }] };
    if (/WHERE affected_appointment_id = \$1\s+AND claimed_at = \$2::timestamptz/.test(sql)) {
      return ledger.claimed_at
        ? { rows: [{
          notification_id: ledger.notification_id,
          expected_start_time: ledger.expected_start_time,
          delay_minutes: ledger.delay_minutes,
          is_delayed: ledger.is_delayed
        }] }
        : { rows: [] };
    }
    if (/UPDATE appointment_delay_notifications/.test(sql)) {
      ledger.notification_id = values[1] || ledger.notification_id;
      ledger.delivery_status = values[2] ? 'sent' : 'failed';
      ledger.email_status = values[5];
      ledger.claimed_at = null;
      return { rows: [{ affected_appointment_id: 2 }] };
    }
    return { rows: [] };
  };
  db.transaction = async (callback) => {
    const result = await callback({
      async query(sql, values = []) {
      if (/SELECT aesthetician_id, appointment_date::text AS appointment_date/.test(sql)) {
        return { rows: [{ aesthetician_id: 31, appointment_date: '2026-01-05' }] };
      }
      if (/SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT a\.appointment_id, a\.user_id/.test(sql)) return { rows: [source, affected] };
      if (/SELECT affected\.appointment_id/.test(sql)) return { rows: [] };
      if (/SELECT notification_id\s+FROM appointment_delay_notifications/.test(sql)) {
        return ledger.claimed_at ? { rows: [{ notification_id: ledger.notification_id }] } : { rows: [] };
      }
      if (/INSERT INTO notifications/.test(sql)) {
        assert.equal(claimTransactionCommitted, true);
        notificationCreates += 1;
        return { rows: [{ notification_id: 901, user_id: affected.user_id }] };
      }
      if (/UPDATE appointment_delay_notifications\s+SET notification_id = \$1, updated_at = NOW\(\)/.test(sql)) {
        ledger.notification_id = values[0];
        return { rows: [] };
      }
      if (/SELECT expected_start_time::text AS expected_start_time/.test(sql)) {
        return { rows: [{
          expected_start_time: ledger.expected_start_time,
          notified_start_time: ledger.notified_start_time,
          is_delayed: ledger.is_delayed,
          delivery_status: ledger.delivery_status,
          email_status: ledger.email_status,
          attempt_count: ledger.attempt_count
        }] };
      }
      if (/INSERT INTO appointment_delay_notifications/.test(sql)) return { rows: [] };
      if (/SELECT notification\.affected_appointment_id/.test(sql)) {
        claimQueries += 1;
        if (claimLocked) return { rows: [] };
        claimLocked = true;
        firstClaimReached();
        await holdClaim;
        return { rows: [{
          ...ledger,
          expected_start_time: '11:00:00',
          user_id: affected.user_id,
          appointment_time: affected.appointment_time,
          appointment_status: 'confirmed'
        }] };
      }
      if (/SET claimed_at = NOW\(\), attempt_count/.test(sql)) {
        ledger.claimed_at = 'claimed';
        ledger.attempt_count = values[1];
        return { rows: [{ claimed_at: '2026-01-05 00:00:00+00' }] };
      }
      if (/SET notification_id = COALESCE/.test(sql)) {
        ledger.notification_id = values[1];
        ledger.delivery_status = values[2] ? 'sent' : 'failed';
        ledger.email_status = values[5];
        ledger.claimed_at = null;
        return { rows: [] };
      }
        return { rows: [] };
      }
    });
    claimTransactionCommitted = true;
    return result;
  };

  try {
    const first = processOneAppointmentDelayNotification(2);
    await firstClaim;
    const second = await processOneAppointmentDelayNotification(2);
    releaseFirstClaim();
    const firstResult = await first;
    assert.deepEqual(firstResult, { sent: 1, failed: 0 });
    assert.deepEqual(second, { sent: 0, failed: 0 });
    assert.equal(claimQueries, 2);
    assert.equal(notificationCreates, 1);
  } finally {
    releaseFirstClaim();
    db.query = originalQuery;
    db.transaction = originalTransaction;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('delay ledger claims are consolidated and use database row locking', () => {
  const notificationSource = fs.readFileSync(path.join(root, 'utils', 'appointmentDelayNotifications.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations', '048-appointment-delay-retries.js'), 'utf8');
  const jobs = fs.readFileSync(path.join(root, 'utils', 'notificationJobs.js'), 'utf8');
  assert.match(notificationSource, /ON CONFLICT \(affected_appointment_id\) DO UPDATE/);
  assert.match(notificationSource, /FOR UPDATE OF notification SKIP LOCKED/);
  assert.match(notificationSource, /attempt_count < \$1/);
  assert.match(migration, /affected_appointment_id INTEGER PRIMARY KEY/);
  assert.match(migration, /already_migrated/);
  assert.match(migration, /legacy\.delivery_status = 'sent'[\s\S]*legacy\.email_status <> 'failed' THEN 'sent'/);
  assert.match(notificationSource, /Appointment delay notification permanently failed/);
  assert.match(jobs, /cron\.schedule\('\* \* \* \* \*', runAppointmentDelayNotificationRetries/);
  assert.match(jobs, /pg_try_advisory_lock\(\$1, \$2\).*203004171, 2/s);
  assert.match(migration, /source_appointment_ids INTEGER\[\]/);
});

test('staff calendar and scheduling paths prefer effective ends while retaining booking exclusions', () => {
  const staffCalendar = fs.readFileSync(path.join(root, 'appointments-staff.js'), 'utf8');
  const availability = fs.readFileSync(path.join(root, 'routes', 'availability.js'), 'utf8');
  const appointments = fs.readFileSync(path.join(root, 'routes', 'appointments.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations', '048-appointment-delay-retries.js'), 'utf8');
  const migrationReadme = fs.readFileSync(path.join(root, 'migrations', 'README.md'), 'utf8');
  assert.match(staffCalendar, /end: appt\.expected_end_time \?\? appt\.expected_end/);
  assert.match(staffCalendar, /formatTime\(appt\.start\).*formatTime\(appt\.end\)/s);
  assert.match(availability, /GREATEST\(appointment_end_time, COALESCE\(adjusted_expected_end_time/);
  assert.ok((appointments.match(/GREATEST\(appointment_end_time, COALESCE\(adjusted_expected_end_time/g) || []).length >= 2);
  assert.match(appointments, /pg_advisory_xact_lock\(\$1, \$2\)/);
  assert.match(appointments, /nextStatus === 'confirmed' && currentStatus !== 'confirmed'/);
  assert.match(migration, /ADD COLUMN booked_duration_is_estimated BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migrationReadme, /cannot be\s+reconstructed reliably from the old schema/);
});
