const db = require('../db');
const { sendNotificationEmail } = require('./mailer');
const { calculateAppointmentEtas, timeToMinutes } = require('./appointmentScheduleEtas');

const MEANINGFUL_DELAY_CHANGE_MINUTES = 5;
const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 10;

function timeLabel(time) {
  const minutes = timeToMinutes(time);
  if (minutes === null) return 'an updated time';
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes % 60).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

function delayMessage(appointment, expectedStartTime, delayMinutes, isDelayed) {
  if (!isDelayed) {
    return `The delay affecting your appointment has cleared. Your appointment remains scheduled for ${timeLabel(appointment.appointment_time)}.`;
  }
  return `Your appointment may be delayed by ${delayMinutes} minute${delayMinutes === 1 ? '' : 's'} due to an ongoing treatment taking longer than expected. Your estimated appointment start time is now ${timeLabel(expectedStartTime)}. We apologize for the inconvenience.`;
}

function meaningfulChange(existing, next) {
  if (Boolean(existing.is_delayed) !== next.isDelayed) return true;
  const compareTime = existing.delivery_status === 'pending'
    ? existing.expected_start_time
    : existing.notified_start_time;
  if (!compareTime) return true;
  const oldMinutes = timeToMinutes(compareTime);
  const newMinutes = timeToMinutes(next.expectedStartTime);
  return oldMinutes === null || newMinutes === null
    || Math.abs(newMinutes - oldMinutes) >= MEANINGFUL_DELAY_CHANGE_MINUTES;
}

function buildNotificationStates(estimates, previousRows) {
  const states = new Map(estimates
    .filter((appointment) => appointment.user_id
      && appointment.appointment_status === 'confirmed'
      && appointment.is_upcoming
      && appointment.is_delayed)
    .map((appointment) => [Number(appointment.appointment_id), {
      ...appointment,
      expected_start_time: appointment.estimated_start_time,
      is_delayed: true,
      source_appointment_ids: appointment.source_appointment_ids
    }]));

  for (const appointment of previousRows) {
    const id = Number(appointment.appointment_id);
    if (!states.has(id)) {
      states.set(id, {
        ...appointment,
        delay_minutes: 0,
        expected_start_time: String(appointment.appointment_time).slice(0, 5),
        source_appointment_ids: [],
        is_delayed: false
      });
    }
  }
  return [...states.values()];
}

async function loadSchedule(client, aestheticianId, appointmentDate) {
  const result = await client.query(`
    SELECT a.appointment_id, a.user_id, a.appointment_date::text AS appointment_date,
           a.appointment_time::text AS appointment_time,
           a.appointment_end_time::text AS appointment_end_time,
           a.adjusted_expected_end_time::text AS adjusted_expected_end_time,
           a.booked_duration_minutes, a.booked_buffer_minutes,
           a.appointment_status,
           TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS current_manila,
           COALESCE(
             NULLIF(BTRIM(CONCAT_WS(' ', a.customer_first_name, a.customer_last_name)), ''),
             NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''),
             a.walk_in_name,
             'Client'
           ) AS client
    FROM appointments a
    LEFT JOIN users client ON client.user_id = a.user_id
    WHERE a.aesthetician_id = $1
      AND a.appointment_date = $2::date
      AND a.appointment_status IN ('confirmed', 'in_progress')
    ORDER BY a.appointment_time, a.appointment_id
  `, [aestheticianId, appointmentDate]);
  return result.rows;
}

async function reconcileSchedule(client, aestheticianId, appointmentDate) {
  const schedule = await loadSchedule(client, aestheticianId, appointmentDate);
  const estimates = calculateAppointmentEtas(schedule).map((appointment) => {
    const nowManila = schedule[0]?.current_manila;
    const [today, nowTime] = nowManila ? nowManila.split(' ') : ['', ''];
    const etaMinutes = timeToMinutes(appointment.estimated_start_time);
    const nowMinutes = timeToMinutes(nowTime);
    return {
      ...appointment,
      is_upcoming: appointment.appointment_date > today
        || (appointment.appointment_date === today && etaMinutes > nowMinutes)
    };
  });

  const previous = await client.query(`
    SELECT affected.appointment_id, affected.user_id,
           affected.appointment_date::text AS appointment_date,
           affected.appointment_time::text AS appointment_time,
           affected.appointment_status,
           COALESCE(
             NULLIF(BTRIM(CONCAT_WS(' ', affected.customer_first_name, affected.customer_last_name)), ''),
             NULLIF(BTRIM(CONCAT_WS(' ', client.first_name, client.last_name)), ''),
             affected.walk_in_name,
             'Client'
           ) AS client
    FROM appointment_delay_notifications notification
    JOIN appointments affected ON affected.appointment_id = notification.affected_appointment_id
    LEFT JOIN users client ON client.user_id = affected.user_id
    WHERE affected.aesthetician_id = $1
      AND affected.appointment_date = $2::date
      AND notification.is_delayed = TRUE
      AND affected.appointment_status = 'confirmed'
      AND (affected.appointment_date + affected.appointment_time)
        > (NOW() AT TIME ZONE 'Asia/Manila')
  `, [aestheticianId, appointmentDate]);

  const states = buildNotificationStates(estimates, previous.rows);
  const notifications = [];
  for (const appointment of states) {
    const state = {
      expectedStartTime: appointment.expected_start_time,
      delayMinutes: appointment.delay_minutes,
      isDelayed: appointment.is_delayed,
      sourceIds: appointment.source_appointment_ids
    };
    const existingResult = await client.query(`
      SELECT expected_start_time::text AS expected_start_time,
             notified_start_time::text AS notified_start_time,
             is_delayed, delivery_status, email_status, attempt_count
      FROM appointment_delay_notifications
      WHERE affected_appointment_id = $1
      FOR UPDATE
    `, [appointment.appointment_id]);
    const existing = existingResult.rows[0];
    const changed = !existing || meaningfulChange(existing, state);

    await client.query(`
      INSERT INTO appointment_delay_notifications (
        affected_appointment_id, source_appointment_ids,
        expected_start_time, delay_minutes, is_delayed,
        delivery_status, email_status, next_attempt_at
      )
      VALUES ($1, $2::integer[], $3::time, $4, $5, 'pending', 'pending', NOW())
      ON CONFLICT (affected_appointment_id) DO UPDATE
      SET source_appointment_ids = EXCLUDED.source_appointment_ids,
          expected_start_time = EXCLUDED.expected_start_time,
          delay_minutes = EXCLUDED.delay_minutes,
          is_delayed = EXCLUDED.is_delayed,
          delivery_status = CASE
            WHEN $6 THEN 'pending'
            ELSE appointment_delay_notifications.delivery_status
          END,
          attempt_count = CASE
            WHEN $6 THEN 0
            ELSE appointment_delay_notifications.attempt_count
          END,
          next_attempt_at = CASE
            WHEN $6 THEN NOW()
            ELSE appointment_delay_notifications.next_attempt_at
          END,
          claimed_at = CASE
            WHEN $6 THEN NULL
            ELSE appointment_delay_notifications.claimed_at
          END,
          last_error = CASE
            WHEN $6 THEN NULL
            ELSE appointment_delay_notifications.last_error
          END,
          updated_at = NOW()
      RETURNING affected_appointment_id
    `, [
      appointment.appointment_id,
      state.sourceIds,
      state.expectedStartTime,
      state.delayMinutes,
      state.isDelayed,
      changed
    ]);

    const wasPending = existing?.delivery_status === 'pending';
    const isRetryable = !existing
      || changed
      || wasPending
      || (Number(existing.attempt_count) < MAX_DELIVERY_ATTEMPTS
        && (existing.delivery_status === 'failed' || existing.email_status === 'failed'));
    if (isRetryable) notifications.push(Number(appointment.appointment_id));
  }

  return {
    estimates: estimates.filter((appointment) => appointment.user_id
      && appointment.is_upcoming && appointment.is_delayed),
    notifications
  };
}

async function deliverNotification(userId, appointmentId, claimedAt, notificationId, message) {
  const persisted = await db.transaction(async (client) => {
    const claimResult = await client.query(`
      SELECT notification_id
      FROM appointment_delay_notifications
      WHERE affected_appointment_id = $1
        AND claimed_at = $2::timestamptz
      FOR UPDATE
    `, [appointmentId, claimedAt]);
    if (!claimResult.rows.length) return { stale: true, notificationId: null };

    let activeNotificationId = claimResult.rows[0].notification_id;
    if (activeNotificationId) {
      const updated = await client.query(`
        UPDATE notifications
        SET message = $1, is_read = FALSE
        WHERE notification_id = $2 AND user_id = $3
        RETURNING notification_id
      `, [message, activeNotificationId, userId]);
      if (!updated.rows.length) activeNotificationId = null;
    }

    if (!activeNotificationId) {
      const inserted = await client.query(`
        INSERT INTO notifications (user_id, type, message)
        VALUES ($1, 'appointment_delay', $2)
        RETURNING notification_id
      `, [userId, message]);
      activeNotificationId = inserted.rows[0]?.notification_id || null;
    }
    if (!activeNotificationId) {
      throw new Error('Could not persist the appointment delay notification.');
    }

    await client.query(`
      UPDATE appointment_delay_notifications
      SET notification_id = $1, updated_at = NOW()
      WHERE affected_appointment_id = $2
        AND claimed_at = $3::timestamptz
    `, [activeNotificationId, appointmentId, claimedAt]);
    return { stale: false, notificationId: activeNotificationId };
  });
  if (persisted.stale) {
    return { ...persisted, delivered: false, emailStatus: 'not_requested' };
  }

  try {
    const recipient = await db.query('SELECT email FROM users WHERE user_id = $1', [userId]);
    if (!recipient.rows[0]?.email) {
      return { ...persisted, delivered: true, emailStatus: 'not_requested' };
    }
    await sendNotificationEmail(recipient.rows[0].email, 'appointment_delay', message);
    return { ...persisted, delivered: true, emailStatus: 'sent' };
  } catch (error) {
    console.error('Could not send appointment delay update email:', error.message);
    return { ...persisted, delivered: true, emailStatus: 'failed', error: error.message };
  }
}

function retryDelayMinutes(attemptCount) {
  return Math.min(60, 2 ** Math.max(0, attemptCount - 1));
}

function getDeliveryOutcome(attemptCount, delivery) {
  const succeeded = delivery.delivered && delivery.emailStatus !== 'failed';
  const exhausted = !succeeded && attemptCount >= MAX_DELIVERY_ATTEMPTS;
  return {
    succeeded,
    exhausted,
    nextAttemptMinutes: succeeded || exhausted ? null : retryDelayMinutes(attemptCount)
  };
}

async function processOneAppointmentDelayNotification(appointmentId) {
  try {
    const claim = await db.transaction(async (client) => {
      const ownerResult = await client.query(`
        SELECT aesthetician_id, appointment_date::text AS appointment_date
        FROM appointments
        WHERE appointment_id = $1
      `, [appointmentId]);
      if (!ownerResult.rows.length || !ownerResult.rows[0].aesthetician_id) return { sent: 0, failed: 0 };
      const { aesthetician_id: staffId, appointment_date: appointmentDate } = ownerResult.rows[0];

      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1042026, staffId]);
      const currentOwner = await client.query(`
        SELECT aesthetician_id, appointment_date::text AS appointment_date
        FROM appointments
        WHERE appointment_id = $1
      `, [appointmentId]);
      if (!currentOwner.rows.length
        || Number(currentOwner.rows[0].aesthetician_id) !== Number(staffId)
        || currentOwner.rows[0].appointment_date !== appointmentDate) {
        return null;
      }
      await reconcileSchedule(client, staffId, appointmentDate);

      const claimResult = await client.query(`
        SELECT notification.affected_appointment_id, notification.notification_id,
               notification.expected_start_time::text AS expected_start_time,
               notification.delay_minutes, notification.is_delayed,
               notification.delivery_status, notification.email_status,
               notification.attempt_count, notification.claimed_at,
               appointment.user_id, appointment.appointment_time::text AS appointment_time,
               appointment.appointment_status
        FROM appointment_delay_notifications notification
        JOIN appointments appointment
          ON appointment.appointment_id = notification.affected_appointment_id
        WHERE notification.affected_appointment_id = $1
          AND notification.attempt_count < $2
          AND notification.next_attempt_at <= NOW()
          AND (notification.claimed_at IS NULL
            OR notification.claimed_at < NOW() - ($3 * INTERVAL '1 minute'))
          AND appointment.appointment_status = 'confirmed'
          AND (appointment.appointment_date + notification.expected_start_time)
            > (NOW() AT TIME ZONE 'Asia/Manila')
          AND (notification.delivery_status IN ('pending', 'failed')
            OR notification.email_status = 'failed')
        FOR UPDATE OF notification SKIP LOCKED
      `, [appointmentId, MAX_DELIVERY_ATTEMPTS, STALE_CLAIM_MINUTES]);
      if (!claimResult.rows.length) return null;

      const appointment = claimResult.rows[0];
      const attemptCount = Number(appointment.attempt_count) + 1;
      const claimed = await client.query(`
        UPDATE appointment_delay_notifications
        SET claimed_at = NOW(), attempt_count = $2, updated_at = NOW()
        WHERE affected_appointment_id = $1
        RETURNING claimed_at::text AS claimed_at
      `, [appointmentId, attemptCount]);

      return {
        appointment,
        attemptCount,
        claimedAt: claimed.rows[0]?.claimed_at
      };
    });
    if (!claim?.claimedAt) return { sent: 0, failed: 0 };

    const currentClaim = await db.query(`
      SELECT notification_id, expected_start_time::text AS expected_start_time,
             delay_minutes, is_delayed
      FROM appointment_delay_notifications
      WHERE affected_appointment_id = $1
        AND claimed_at = $2::timestamptz
    `, [appointmentId, claim.claimedAt]);
    if (!currentClaim.rows.length) return { sent: 0, failed: 0 };

    const appointment = { ...claim.appointment, ...currentClaim.rows[0] };
    const message = delayMessage(
      appointment,
      appointment.expected_start_time,
      Number(appointment.delay_minutes),
      appointment.is_delayed,
    );
    let delivery;
    try {
      delivery = await deliverNotification(
        appointment.user_id,
        appointmentId,
        claim.claimedAt,
        appointment.notification_id,
        message,
      );
    } catch (error) {
      delivery = {
        notificationId: appointment.notification_id,
        delivered: false,
        emailStatus: 'failed',
        error: error.message
      };
    }
    if (delivery.stale) return { sent: 0, failed: 0 };

    const { succeeded, exhausted, nextAttemptMinutes } = getDeliveryOutcome(claim.attemptCount, delivery);
    const errorMessage = delivery.error || (!delivery.delivered
      ? 'In-app notification delivery failed.'
      : delivery.emailStatus === 'failed' ? 'Email delivery failed.' : null);

    const updated = await db.query(`
      UPDATE appointment_delay_notifications
      SET notification_id = COALESCE($2, notification_id),
          notified_start_time = CASE WHEN $5 THEN expected_start_time ELSE notified_start_time END,
          notified_delay_minutes = CASE WHEN $5 THEN delay_minutes ELSE notified_delay_minutes END,
          delivery_status = CASE
            WHEN $3 THEN 'sent'
            WHEN $4 THEN 'failed'
            WHEN $5 THEN 'sent'
            ELSE 'failed'
          END,
          email_status = $6,
          last_notified_at = CASE WHEN $5 THEN NOW() ELSE last_notified_at END,
          next_attempt_at = CASE
            WHEN $3 OR $4 THEN NULL
            ELSE NOW() + ($7 * INTERVAL '1 minute')
          END,
          claimed_at = NULL,
          last_error = $8,
          updated_at = NOW()
      WHERE affected_appointment_id = $1
        AND claimed_at = $9::timestamptz
      RETURNING affected_appointment_id
    `, [
      appointmentId,
      delivery.notificationId,
      succeeded,
      exhausted,
      delivery.delivered,
      delivery.emailStatus,
      nextAttemptMinutes,
      exhausted ? `Permanently failed after ${claim.attemptCount} attempts: ${errorMessage}` : errorMessage,
      claim.claimedAt
    ]);

    if (!updated.rows.length) return { sent: delivery.delivered ? 1 : 0, failed: 0 };
    if (exhausted) {
      console.error(`Appointment delay notification permanently failed for appointment ${appointmentId} after ${claim.attemptCount} attempts: ${errorMessage}`);
    }
    return { sent: delivery.delivered ? 1 : 0, failed: delivery.delivered ? 0 : 1 };
  } catch (error) {
    console.error(`Appointment delay notification retry failed for appointment ${appointmentId}:`, error);
    return { sent: 0, failed: 1 };
  }
}

async function processPendingAppointmentDelayNotifications({ limit = 50 } = {}) {
  const result = await db.query(`
    SELECT affected_appointment_id
    FROM appointment_delay_notifications
    WHERE attempt_count < $1
      AND next_attempt_at <= NOW()
      AND (claimed_at IS NULL OR claimed_at < NOW() - ($2 * INTERVAL '1 minute'))
      AND (delivery_status IN ('pending', 'failed') OR email_status = 'failed')
    ORDER BY next_attempt_at, affected_appointment_id
    LIMIT $3
  `, [MAX_DELIVERY_ATTEMPTS, STALE_CLAIM_MINUTES, limit]);

  const totals = { sent: 0, failed: 0, processed: 0 };
  for (const row of result.rows) {
    const outcome = await processOneAppointmentDelayNotification(row.affected_appointment_id);
    totals.sent += outcome.sent;
    totals.failed += outcome.failed;
    totals.processed += 1;
  }
  return totals;
}

async function reconcileAppointmentDelayNotifications(aestheticianId, appointmentDate) {
  const reconciled = await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1042026, aestheticianId]);
    return reconcileSchedule(client, aestheticianId, appointmentDate);
  });

  const totals = { sent: 0, failed: 0 };
  for (const appointmentId of reconciled.notifications) {
    const result = await processOneAppointmentDelayNotification(appointmentId);
    totals.sent += result.sent;
    totals.failed += result.failed;
  }
  return {
    ...totals,
    affectedAppointments: reconciled.estimates.map((appointment) => ({
      appointment_id: appointment.appointment_id,
      user_id: appointment.user_id,
      client: appointment.client,
      appointment_time: appointment.appointment_time,
      appointment_date: appointment.appointment_date,
      estimated_start_time: appointment.estimated_start_time,
      delay_minutes: appointment.delay_minutes,
      source_appointment_ids: appointment.source_appointment_ids
    }))
  };
}

module.exports = {
  MAX_DELIVERY_ATTEMPTS,
  buildNotificationStates,
  calculateAppointmentEtas,
  getDeliveryOutcome,
  processOneAppointmentDelayNotification,
  processPendingAppointmentDelayNotifications,
  reconcileAppointmentDelayNotifications
};
