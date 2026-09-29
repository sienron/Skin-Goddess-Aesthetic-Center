const cron = require('node-cron');
const db = require('../db');
const { notifyUser, notifyRoles } = require('./notifications');

let remindersRunning = false;
let expiryRunning = false;

function appointmentLabel(row) {
  return `${row.service_name} on ${row.appointment_date} at ${String(row.appointment_time).slice(0, 5)}`;
}

async function sendReminders(flag, hours, type) {
  const result = await db.query(`
    UPDATE appointments a
    SET ${flag} = TRUE
    FROM services s
    WHERE a.service_id = s.service_id
      AND a.appointment_status IN ('pending', 'confirmed')
      AND a.${flag} = FALSE
      AND a.appointment_date + a.appointment_time > (NOW() AT TIME ZONE 'Asia/Manila')
      AND a.appointment_date + a.appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila') + ($1 * INTERVAL '1 hour')
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
  cron.schedule('0 9 * * *', runExpiryAlerts, { timezone: 'Asia/Manila' });
}

module.exports = { startNotificationJobs, runAppointmentReminders, runExpiryAlerts };