const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const notifications = require('../utils/notifications');
const mailer = require('../utils/mailer');

let notificationCalls = [];
let emailCalls = [];
let reminderSender = async () => {};
const originalQuery = db.query;
const originalConnect = db.pool.connect;
const originalNotifyUser = notifications.notifyUser;
const originalSendReminder = mailer.sendAppointmentReminderEmail;

notifications.notifyUser = async (...args) => notificationCalls.push(args);
mailer.sendAppointmentReminderEmail = async (...args) => {
  emailCalls.push(args);
  return reminderSender(...args);
};
const jobs = require('../utils/notificationJobs');

test('in-app 24-hour reminders exclude appointments already in the 3-hour window', async () => {
  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [] };
  };

  try {
    await jobs.runAppointmentReminders();
  } finally {
    db.query = originalQuery;
  }

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /appointment_time > .*INTERVAL '3 hours'/);
  assert.deepEqual(queries.map(({ values }) => values), [[24], [3]]);
  assert.match(queries[0].sql, /appointment_status IN \('pending', 'confirmed'\)/);
  assert.match(queries[0].sql, /a\.user_id IS NOT NULL/);
});

test('email reminders select only registered confirmed appointments and use separate 24h/3h windows', async () => {
  const queries = [];
  const clientQueries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    if (/^SELECT a\.appointment_id/.test(sql.trim())) {
      return {
        rows: [{
          appointment_id: values[0] === 24 ? 24 : 3,
          email: 'client@example.test',
          first_name: 'Client',
          service_name: 'Service',
          appointment_date: '2026-10-20',
          appointment_time: '10:00:00'
        }]
      };
    }
    if (/SET reminder_email_/.test(sql)) return { rows: [{ appointment_id: values[0] }] };
    return { rows: [] };
  };
  db.pool.connect = async () => ({
    async query(sql, values) {
      clientQueries.push({ sql, values });
      return { rows: [{ acquired: true }] };
    },
    release() {}
  });

  try {
    await jobs.runAppointmentEmailReminders();
  } finally {
    db.query = originalQuery;
    db.pool.connect = originalConnect;
  }

  const selects = queries.filter(({ sql }) => /^SELECT a\.appointment_id/.test(sql.trim()));
  assert.deepEqual(selects.map(({ values }) => values), [[24], [3]]);
  assert.ok(selects.every(({ sql }) => /a\.appointment_status = 'confirmed'/.test(sql)));
  assert.ok(selects.every(({ sql }) => /JOIN users u ON u\.user_id = a\.user_id/.test(sql)));
  assert.match(selects[0].sql, /appointment_time > .*INTERVAL '3 hours'/);
  assert.deepEqual(emailCalls.map(([, hours]) => hours), [24, 3]);
  assert.ok(queries.some(({ sql }) => /SET reminder_email_24h_sent = TRUE/.test(sql)));
  assert.ok(queries.some(({ sql }) => /SET reminder_email_3h_sent = TRUE/.test(sql)));
  assert.ok(clientQueries.some(({ sql }) => /pg_try_advisory_lock/.test(sql)));
  assert.ok(clientQueries.some(({ sql }) => /pg_advisory_unlock/.test(sql)));
});

test('overdue appointment job only transitions confirmed appointments after scheduled end time', async () => {
  let updateSql = '';
  db.query = async (sql) => {
    updateSql = sql;
    return { rows: [{ appointment_id: 42, user_id: 7 }] };
  };

  try {
    await jobs.runOverdueAppointments();
  } finally {
    db.query = originalQuery;
  }

  assert.match(updateSql, /appointment_status = 'confirmed'/);
  assert.match(updateSql, /appointment_date \+ appointment_end_time <= \(NOW\(\) AT TIME ZONE 'Asia\/Manila'\)/);
  assert.match(updateSql, /SET appointment_status = 'no_show'/);
  assert.deepEqual(notificationCalls.at(-1), [
    7,
    'appointment_status_changed',
    'Appointment 42 status changed to no show because its scheduled time passed.'
  ]);
});

test('failed reminder delivery is logged and its claim is released for a later retry', async () => {
  const queries = [];
  const originalConsoleError = console.error;
  const originalSender = reminderSender;
  console.error = () => {};
  reminderSender = async () => {
    throw new Error('Simulated email failure');
  };
  db.query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (/^SELECT a\.appointment_id/.test(sql.trim())) {
      return {
        rows: values[0] === 3
          ? [{
            appointment_id: 55,
            email: 'client@example.test',
            first_name: 'Client',
            service_name: 'Service',
            appointment_date: '2026-10-20',
            appointment_time: '10:00:00'
          }]
          : []
      };
    }
    if (/SET reminder_email_/.test(sql) && /RETURNING appointment_id/.test(sql)) {
      return { rows: [{ appointment_id: values[0] }] };
    }
    return { rows: [] };
  };
  db.pool.connect = async () => ({
    async query() {
      return { rows: [{ acquired: true }] };
    },
    release() {}
  });

  try {
    await jobs.runAppointmentEmailReminders();
  } finally {
    db.query = originalQuery;
    db.pool.connect = originalConnect;
    console.error = originalConsoleError;
    reminderSender = originalSender;
  }

  assert.ok(queries.some(({ sql }) => /SET reminder_email_3h_sent = TRUE/.test(sql)));
  assert.ok(queries.some(({ sql }) => /SET reminder_email_3h_sent = FALSE/.test(sql)));
});

test.after(() => {
  db.query = originalQuery;
  db.pool.connect = originalConnect;
  notifications.notifyUser = originalNotifyUser;
  mailer.sendAppointmentReminderEmail = originalSendReminder;
});
