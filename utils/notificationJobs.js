const cron = require('node-cron');
const db = require('../db');
const { notifyUser, notifyRoles } = require('./notifications');
const { sendAppointmentReminderEmail } = require('./mailer');

let remindersRunning = false;
let emailRemindersRunning = false;
let expiryRunning = false;
let overdueAppointmentsRunning = false;

function appointmentLabel(row) {
  return `${row.service_name} on ${row.appointment_date} at ${String(row.appointment_time).slice(0, 5)}`;
}

async function sendReminders(flag, hours, type) {
  const result = await db.query(`
    UPDATE appointments a
    SET ${flag} = TRUE
    FROM services s
    WHERE a.service_id = s.service_id
      AND a.user_id IS NOT NULL
      AND a.appointment_status IN ('pending', 'confirmed')
      AND a.${flag} = FALSE
      AND a.appointment_date + a.appointment_time > (NOW() AT TIME ZONE 'Asia/Manila')
      AND a.appointment_date + a.appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila') + ($1 * INTERVAL '1 hour')
      AND ($1::integer <> 24 OR a.appointment_date + a.appointment_time > (NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '3 hours')
    RETURNING a.user_id, a.appointment_date::text AS appointment_date,
              a.appointment_time::text AS appointment_time, s.service_name
  `, [hours]);

  await Promise.all(result.rows.map((row) => notifyUser(
    row.user_id,
    type,
    `Reminder: your ${appointmentLabel(row)} appointment is coming up.`,
  )));
}

async function runAppointmentReminders() {
  if (remindersRunning) return;
  remindersRunning = true;
  try {
    await sendReminders('reminder_24h_sent', 24, 'appointment_reminder_24h');
    await sendReminders('reminder_3h_sent', 3, 'appointment_reminder_3h');
  } catch (error) {
    console.error('Appointment reminder job failed:', error.message);
  } finally {
    remindersRunning = false;
  }
}

async function sendAppointmentEmailReminders(flag, hours) {
  const now = "(NOW() AT TIME ZONE 'Asia/Manila')";
  const result = await db.query(`
    SELECT a.appointment_id, u.email, u.first_name, s.service_name,
           a.appointment_date::text AS appointment_date,
           a.appointment_time::text AS appointment_time
    FROM appointments a
    JOIN users u ON u.user_id = a.user_id
    JOIN services s ON s.service_id = a.service_id
    WHERE a.appointment_status = 'confirmed'
      AND a.${flag} = FALSE
      AND a.appointment_date + a.appointment_time > ${now}
      AND a.appointment_date + a.appointment_time <= ${now} + ($1 * INTERVAL '1 hour')
      AND ($1::integer <> 24 OR a.appointment_date + a.appointment_time > ${now} + INTERVAL '3 hours')
    ORDER BY a.appointment_date, a.appointment_time
  `, [hours]);

  for (const appointment of result.rows) {
    const claim = await db.query(`
      UPDATE appointments
      SET ${flag} = TRUE
      WHERE appointment_id = $1 AND ${flag} = FALSE
        AND appointment_status = 'confirmed'
        AND appointment_date = $2::date AND appointment_time = $3::time
        AND appointment_date + appointment_time > ${now}
        AND appointment_date + appointment_time <= ${now} + ($4 * INTERVAL '1 hour')
        AND ($4::integer <> 24 OR appointment_date + appointment_time > ${now} + INTERVAL '3 hours')
      RETURNING appointment_id
    `, [
      appointment.appointment_id,
      appointment.appointment_date,
      appointment.appointment_time,
      hours
    ]);
    if (!claim.rows.length) continue;

    try {
      await sendAppointmentReminderEmail(appointment, hours);
    } catch (error) {
      console.error(
        `Could not send ${hours}-hour appointment reminder for appointment ${appointment.appointment_id}:`,
        error.message,
      );
      try {
        await db.query(`
          UPDATE appointments
          SET ${flag} = FALSE
          WHERE appointment_id = $1 AND ${flag} = TRUE
            AND appointment_status = 'confirmed'
            AND appointment_date = $2::date AND appointment_time = $3::time
        `, [
          appointment.appointment_id,
          appointment.appointment_date,
          appointment.appointment_time
        ]);
      } catch (resetError) {
        console.error(
          `Could not reset ${hours}-hour appointment reminder for appointment ${appointment.appointment_id}:`,
          resetError.message
        );
      }
    }
  }
}

async function runAppointmentEmailReminders() {
  if (emailRemindersRunning) return;
  emailRemindersRunning = true;

  let client;
  let lockAcquired = false;
  try {
    client = await db.pool.connect();
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [203004171, 1]);
    lockAcquired = lockResult.rows[0].acquired;
    if (!lockAcquired) return;

    await sendAppointmentEmailReminders('reminder_email_24h_sent', 24);
    await sendAppointmentEmailReminders('reminder_email_3h_sent', 3);
  } catch (error) {
    console.error('Appointment email reminder job failed:', error.message);
  } finally {
    if (lockAcquired && client) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [203004171, 1]);
      } catch (error) {
        console.error('Could not release appointment email reminder lock:', error.message);
      }
    }
    if (client) client.release();
    emailRemindersRunning = false;
  }
}

async function runOverdueAppointments() {
  if (overdueAppointmentsRunning) return;
  overdueAppointmentsRunning = true;
  try {
    const result = await db.query(`
      UPDATE appointments
      SET appointment_status = 'no_show', updated_at = NOW()
      WHERE appointment_status = 'confirmed'
        AND appointment_date + appointment_end_time <= (NOW() AT TIME ZONE 'Asia/Manila')
      RETURNING appointment_id, user_id
    `);

    for (const appointment of result.rows) {
      if (!appointment.user_id) continue;
      try {
        await notifyUser(
          appointment.user_id,
          'appointment_status_changed',
          `Appointment ${appointment.appointment_id} status changed to no show because its scheduled time passed.`
        );
      } catch (error) {
        console.error(
          `No-show notification failed for appointment ${appointment.appointment_id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error('Overdue appointment job failed:', error.message);
  } finally {
    overdueAppointmentsRunning = false;
  }
}

async function runExpiryAlerts() {
  if (expiryRunning) return;
  expiryRunning = true;
  try {
    const result = await db.query(`
      WITH candidates AS (
        SELECT product_id, product_name, expiry_date,
          CASE
            WHEN expiry_date < (NOW() AT TIME ZONE 'Asia/Manila')::date THEN 'inventory_expired'
            WHEN expiry_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date + 30 THEN 'inventory_expiring_30d'
            ELSE 'inventory_expiring_60d'
          END AS alert_type
        FROM inventory_products
        WHERE expiry_date IS NOT NULL
          AND expiry_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date + 60
      ), inserted AS (
        INSERT INTO inventory_expiry_alerts (product_id, expiry_date, alert_type)
        SELECT product_id, expiry_date, alert_type FROM candidates
        ON CONFLICT DO NOTHING
        RETURNING product_id, expiry_date, alert_type
      )
      SELECT c.product_id, c.product_name, c.expiry_date::text AS expiry_date, c.alert_type
      FROM inserted i
      JOIN candidates c USING (product_id, expiry_date, alert_type)
    `);

    for (const alert of result.rows) {
      const description = alert.alert_type === 'inventory_expired'
        ? `${alert.product_name} expired on ${alert.expiry_date}.`
        : `${alert.product_name} expires on ${alert.expiry_date}.`;
      await notifyRoles(['inventory_officer', 'admin'], alert.alert_type, description);
    }
  } catch (error) {
    console.error('Inventory expiry job failed:', error.message);
  } finally {
    expiryRunning = false;
  }
}

function startNotificationJobs() {
  cron.schedule('*/5 * * * *', runAppointmentReminders, { timezone: 'Asia/Manila' });
  cron.schedule('*/5 * * * *', runAppointmentEmailReminders, { timezone: 'Asia/Manila' });
  cron.schedule('*/5 * * * *', runOverdueAppointments, { timezone: 'Asia/Manila' });
  cron.schedule('0 9 * * *', runExpiryAlerts, { timezone: 'Asia/Manila' });
}

module.exports = {
  startNotificationJobs,
  runAppointmentReminders,
  runAppointmentEmailReminders,
  runOverdueAppointments,
  runExpiryAlerts,
};