const db = require('../db');
const { sendNotificationEmail } = require('./mailer');
let running = false;

async function queueClinicEvent(client, { key, type, message, closureId = null, appointmentId = null, userIds = [], roles = [], email = true }) {
  const recipients = await client.query(`SELECT user_id FROM users WHERE status='active'
    AND (user_id=ANY($1::integer[]) OR role::text=ANY($2::text[]))`, [userIds.filter(Boolean), roles]);
  for (const { user_id } of recipients.rows) {
    await client.query('SELECT clinic_queue_event($1,$2,$3,$4,$5,$6,$7)', [key, user_id, type, message, closureId, appointmentId, email]);
  }
}

async function processClinicNotifications() {
  if (running) return;
  running = true;
  try {
    // Claims survive restarts. SKIP LOCKED allows multiple server processes safely.
    const claims = await db.query(`WITH candidates AS (
      SELECT delivery_id FROM clinic_notification_deliveries
      WHERE (email_status IN ('pending','failed') OR (email_status='sending' AND attempted_at < NOW()-INTERVAL '2 minutes'))
        AND attempts < 3 AND (attempted_at IS NULL OR attempted_at < NOW()-INTERVAL '30 seconds')
      ORDER BY delivery_id LIMIT 30 FOR UPDATE SKIP LOCKED
    ) UPDATE clinic_notification_deliveries d SET email_status='sending',attempts=attempts+1,attempted_at=NOW()
      FROM candidates c WHERE d.delivery_id=c.delivery_id RETURNING d.*`);
    for (let offset = 0; offset < claims.rows.length; offset += 5) {
      await Promise.all(claims.rows.slice(offset, offset + 5).map(async (delivery) => {
        try {
          const result = await db.query(`SELECT u.email,n.type,n.message FROM users u
            JOIN notifications n ON n.notification_id=$2 WHERE u.user_id=$1`, [delivery.user_id, delivery.notification_id]);
          const notice = result.rows[0];
          if (!notice?.email) throw new Error('Recipient email is unavailable.');
          await sendNotificationEmail(notice.email, notice.type, notice.message, { idempotencyKey: delivery.idempotency_key });
          await db.query("UPDATE clinic_notification_deliveries SET email_status='sent',sent_at=NOW(),last_error=NULL WHERE delivery_id=$1", [delivery.delivery_id]);
        } catch (error) {
          // Keep provider payloads and addresses out of staff-visible errors.
          console.error(`Clinic email delivery ${delivery.delivery_id} failed:`, error.message);
          await db.transaction(async (client) => {
            await client.query("UPDATE clinic_notification_deliveries SET email_status='failed',last_error='Email provider did not confirm delivery. Check Brevo configuration or retry.' WHERE delivery_id=$1", [delivery.delivery_id]);
            await queueClinicEvent(client, { key: `email-failed:${delivery.delivery_id}`, type: 'clinic_email_failed',
              message: `Clinic email delivery ${delivery.delivery_id} failed. Review notification delivery in Clinic Management.`,
              closureId: delivery.closure_id, appointmentId: delivery.appointment_id, roles: ['admin'], email: false });
          });
        }
      }));
    }
  } catch (error) {
    console.error('Clinic notification delivery job failed:', error.message);
  } finally { running = false; }
}
module.exports = { queueClinicEvent, processClinicNotifications };
