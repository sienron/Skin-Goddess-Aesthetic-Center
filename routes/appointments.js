const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { roleForCategory } = require('../utils/staffRoles');
const { notifyUser, notifyUsers, notifyRoles } = require('../utils/notifications');
const { createHmac, randomBytes, timingSafeEqual } = require('crypto');
const RATING_WINDOW_DAYS = 14;
const ratingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { message: 'Too many rating attempts. Try again later.' } });
const { VALID_SLOTS, CLOSING_TIME, CLOSED_WEEKDAYS, MAX_ADVANCE_DAYS, MIN_BOOKING_LEAD_MINUTES, to24h, from24h, addMinutes, manilaNow, isSlotInPast, isSlotTooSoon } = require('../utils/slots');

function getPayMongoConfig() {
  const isLive = process.env.NODE_ENV === 'production';
  const secretKey = isLive
    ? (process.env.PAYMONGO_LIVE_SECRET_KEY || process.env.PAYMONGO_SK)
    : (process.env.PAYMONGO_TEST_SECRET_KEY || process.env.PAYMONGO_SK);
  const webhookSecret = isLive
    ? process.env.PAYMONGO_LIVE_WEBHOOK_SECRET
    : process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
  const keyPrefix = isLive ? 'sk_live_' : 'sk_test_';

  if (!secretKey || !secretKey.startsWith(keyPrefix) || !webhookSecret) return null;

  return { mode: isLive ? 'live' : 'test', isLive, secretKey, webhookSecret };
}

function payMongoSignatureIsValid(signatureHeader, rawBody, config) {
  if (typeof signatureHeader !== 'string' || !Buffer.isBuffer(rawBody)) return false;
  const fields = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  if (!/^\d+$/.test(fields.t || '')) return false;

  const suppliedSignature = fields[config.isLive ? 'li' : 'te'];
  if (!suppliedSignature || !/^[a-f\d]{64}$/i.test(suppliedSignature)) return false;
  const expectedSignature = createHmac('sha256', config.webhookSecret)
    .update(`${fields.t}.${rawBody.toString('utf8')}`)
    .digest();
  const actualSignature = Buffer.from(suppliedSignature, 'hex');
  return actualSignature.length === expectedSignature.length && timingSafeEqual(actualSignature, expectedSignature);
}

function checkoutReturnUrl(baseUrl, outcome, referenceNumber) {
  const url = new URL('/AppointmentSummary.html', baseUrl);
  url.searchParams.set('payment', outcome);
  url.searchParams.set('reference', referenceNumber);
  return url.toString();
}

function financeMethodForPayMongo(paymentAttributes) {
  const sourceType = String(paymentAttributes?.source?.type || '').toLowerCase();
  if (sourceType === 'gcash') return 'gcash';
  if (sourceType === 'paymaya' || sourceType === 'maya') return 'maya';
  if (sourceType === 'card') return 'card';
  return 'paymongo';
}

async function refundPayMongoPayment({ paymentId, amountCents, reason, config }) {
  if (!paymentId) return { ok: false, message: 'No PayMongo payment is on file for this checkout.' };
  try {
    const response = await fetch('https://api.paymongo.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { attributes: { amount: amountCents, payment_id: paymentId, reason, notes: 'Skin Goddess automatic refund' } } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: data?.errors?.[0]?.detail || 'PayMongo refund request failed.' };
    return { ok: true, refundId: data?.data?.id };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

// Refunds a checkout session still sitting at status 'paid' with no appointment created
// (e.g. lost the race for a slot, or the payment arrived after the appointment started).
async function attemptCheckoutRefund(referenceNumber, amountCents, paymentId, reason) {
  const config = getPayMongoConfig();
  if (!config) return { refunded: false };
  const refund = await refundPayMongoPayment({ paymentId, amountCents, reason, config });
  if (!refund.ok) {
    console.error('PayMongo refund failed for checkout', referenceNumber, refund.message);
    return { refunded: false };
  }
  await db.query(`
    UPDATE paymongo_checkout_sessions
    SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
    WHERE reference_number = $1 AND status = 'paid'
  `, [referenceNumber]);
  return { refunded: true };
}

// Refunds the reservation fee for an already-confirmed appointment being cancelled.
async function refundAppointmentDeposit(appointmentId) {
  const config = getPayMongoConfig();
  if (!config) return { refunded: false };

  const sessionResult = await db.query(`
    SELECT reference_number, payment_id, amount_cents
    FROM paymongo_checkout_sessions
    WHERE appointment_id = $1 AND status = 'consumed' AND payment_id IS NOT NULL
  `, [appointmentId]);
  if (sessionResult.rows.length === 0) return { refunded: false };
  const session = sessionResult.rows[0];

  const refund = await refundPayMongoPayment({
    paymentId: session.payment_id,
    amountCents: session.amount_cents,
    reason: 'requested_by_customer',
    config
  });
  if (!refund.ok) {
    console.error('PayMongo refund failed for appointment', appointmentId, refund.message);
    return { refunded: false };
  }

  await db.query(`
    UPDATE paymongo_checkout_sessions
    SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
    WHERE reference_number = $1
  `, [session.reference_number]);
  await db.query(`UPDATE appointments SET payment_status = 'refunded' WHERE appointment_id = $1`, [appointmentId]);
  return { refunded: true };
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Validates calendar components without constructing a JavaScript Date.
function formatRealDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeDate(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? formatRealDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { year, month, day } = value;
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? formatRealDate(year, month + 1, day)
    : null;
}

// Sunday is 0. This arithmetic is timezone-independent and works on plain dates.
function weekday(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (adjustedYear + Math.floor(adjustedYear / 4) - Math.floor(adjustedYear / 100) + Math.floor(adjustedYear / 400) + offsets[month - 1] + day) % 7;
}

function addCalendarDays(dateStr, count) {
  let [year, month, day] = dateStr.split('-').map(Number);
  for (let remaining = count; remaining > 0; remaining -= 1) {
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  return formatRealDate(year, month, day);
}

function validServiceId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function validAppointmentId(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function validNoteId(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function validNoteColor(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null;
}

function validNoteText(value) {
  return typeof value === 'string' && value.length <= 5000 ? value : null;
}

function validRequestText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength ? value.trim() : null;
}

function validRatingValue(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

// Returns { ok: false } when the comment is malformed, otherwise { ok: true, value } (value may be null).
function validRatingComment(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > 1000) return { ok: false };
  return { ok: true, value: value.trim() || null };
}

router.get('/admin', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.appointment_id,
             a.appointment_date::text AS date,
             a.appointment_time::text AS start,
             a.appointment_end_time::text AS end,
             a.appointment_status AS status,
             a.payment_status,
             s.service_name AS service,
             s.duration_minutes,
             a.booked_service_price AS fee,
             a.booked_reservation_fee AS deposit_amount,
             a.cancellation_request_status,
             a.cancellation_reason,
             a.cancellation_description,
             a.cancellation_requested_at,
             CONCAT_WS(' ', NULLIF(BTRIM(c.first_name), ''), NULLIF(BTRIM(c.last_name), '')) AS client,
             c.gender,
             c.date_of_birth::text AS date_of_birth,
             c.contact_number AS contact,
             COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(aesthetician.first_name), ''), NULLIF(BTRIM(aesthetician.last_name), ''))), ''), 'Unassigned') AS assigned_to,
             (
               SELECT COUNT(*)
               FROM appointments previous
               WHERE previous.user_id = a.user_id
                 AND (previous.appointment_date, previous.appointment_time) < (a.appointment_date, a.appointment_time)
             ) AS previous_appointment_count
      FROM appointments a
      JOIN users c ON c.user_id = a.user_id
      JOIN services s ON s.service_id = a.service_id
      LEFT JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
      ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.appointment_id ASC
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin appointments:', error);
    return res.status(500).json({ message: 'Could not load appointments.' });
  }
});

router.get('/admin/cancellation-requests', requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(`
            SELECT a.appointment_id, a.appointment_date::text AS date, a.appointment_time::text AS start,
              a.appointment_status AS status, 'cancellation' AS request_type,
              a.cancellation_reason AS request_reason, a.cancellation_description AS request_description,
              a.cancellation_requested_at AS requested_at, NULL::text AS requested_date, NULL::text AS requested_time,
             CONCAT_WS(' ', c.first_name, c.last_name) AS client,
             CONCAT_WS(' ', aesthetician.first_name, aesthetician.last_name) AS aesthetician,
             s.service_name AS service
      FROM appointments a
      JOIN users c ON c.user_id = a.user_id
      JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
      JOIN services s ON s.service_id = a.service_id
      WHERE a.cancellation_request_status = 'pending'
      UNION ALL
      SELECT a.appointment_id, a.appointment_date::text AS date, a.appointment_time::text AS start,
             a.appointment_status AS status, 'reschedule' AS request_type,
             a.reschedule_reason AS request_reason, a.reschedule_description AS request_description,
             a.reschedule_requested_at AS requested_at, a.reschedule_requested_date::text AS requested_date,
             a.reschedule_requested_time::text AS requested_time,
             CONCAT_WS(' ', c.first_name, c.last_name) AS client,
             CONCAT_WS(' ', aesthetician.first_name, aesthetician.last_name) AS aesthetician,
             s.service_name AS service
      FROM appointments a
      JOIN users c ON c.user_id = a.user_id
      JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
      JOIN services s ON s.service_id = a.service_id
      WHERE a.reschedule_request_status = 'pending'
      ORDER BY requested_at ASC, appointment_id ASC
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cancellation requests:', error);
    return res.status(500).json({ message: 'Could not load cancellation requests.' });
  }
});

async function getAssignedAppointment(appointmentId, userId) {
  const result = await db.query(`
    SELECT appointment_id
    FROM appointments
    WHERE appointment_id = $1 AND aesthetician_id = $2
  `, [appointmentId, userId]);
  return result.rows.length > 0;
}

function noteResponse(row) {
  return {
    id: row.note_id,
    text: row.note_text,
    color: row.color,
    updatedAt: row.updated_at,
  };
}

router.get('/:id/notes', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  try {
    if (!(await getAssignedAppointment(appointmentId, req.session.userId))) {
      return res.status(403).json({ message: 'You cannot access notes for this appointment.' });
    }

    const result = await db.query(`
      SELECT note_id, note_text, color, updated_at
      FROM treatment_notes
      WHERE appointment_id = $1
      ORDER BY created_at ASC, note_id ASC
    `, [appointmentId]);
    return res.json(result.rows.map(noteResponse));
  } catch (error) {
    console.error('Error fetching treatment notes:', error);
    return res.status(500).json({ message: 'Could not load treatment notes.' });
  }
});

router.get('/client/:clientId/notes', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const clientId = validAppointmentId(req.params.clientId);
  if (!clientId) return res.status(400).json({ message: 'Choose a valid client.' });

  try {
    const result = await db.query(`
      SELECT tn.note_id, tn.note_text, tn.color, tn.updated_at,
             a.appointment_id, a.appointment_date::text AS appointment_date,
             a.appointment_status, s.service_name
      FROM treatment_notes tn
      JOIN appointments a ON a.appointment_id = tn.appointment_id
      JOIN services s ON s.service_id = a.service_id
      WHERE a.user_id = $1 AND a.aesthetician_id = $2
      ORDER BY a.appointment_date DESC, a.appointment_time DESC, tn.created_at ASC, tn.note_id ASC
    `, [clientId, req.session.userId]);

    return res.json(result.rows.map((row) => ({
      ...noteResponse(row),
      appointmentId: row.appointment_id,
      appointmentDate: row.appointment_date,
      appointmentStatus: row.appointment_status,
      service: row.service_name,
    })));
  } catch (error) {
    console.error('Error fetching client treatment notes:', error);
    return res.status(500).json({ message: 'Could not load client treatment notes.' });
  }
});

router.post('/:id/notes', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const text = validNoteText(body.text);
  const color = validNoteColor(body.color);
  if (text === null) return res.status(400).json({ message: 'Note text must be 5,000 characters or fewer.' });
  if (!color) return res.status(400).json({ message: 'Choose a valid note color.' });

  try {
    if (!(await getAssignedAppointment(appointmentId, req.session.userId))) {
      return res.status(403).json({ message: 'You cannot add notes to this appointment.' });
    }

    const result = await db.query(`
      INSERT INTO treatment_notes (appointment_id, author_id, note_text, color)
      VALUES ($1, $2, $3, $4)
      RETURNING note_id, note_text, color, updated_at
    `, [appointmentId, req.session.userId, text, color]);
    return res.status(201).json(noteResponse(result.rows[0]));
  } catch (error) {
    console.error('Error creating treatment note:', error);
    return res.status(500).json({ message: 'Could not create treatment note.' });
  }
});

router.patch('/:id/notes/:noteId', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  const noteId = validNoteId(req.params.noteId);
  if (!appointmentId || !noteId) return res.status(400).json({ message: 'Choose a valid note.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
  const hasColor = Object.prototype.hasOwnProperty.call(body, 'color');
  if (!hasText && !hasColor) return res.status(400).json({ message: 'Provide note text or color.' });
  const text = hasText ? validNoteText(body.text) : null;
  const color = hasColor ? validNoteColor(body.color) : null;
  if (hasText && text === null) return res.status(400).json({ message: 'Note text must be 5,000 characters or fewer.' });
  if (hasColor && !color) return res.status(400).json({ message: 'Choose a valid note color.' });

  try {
    if (!(await getAssignedAppointment(appointmentId, req.session.userId))) {
      return res.status(403).json({ message: 'You cannot edit notes for this appointment.' });
    }

    const result = await db.query(`
      UPDATE treatment_notes
      SET note_text = COALESCE($1, note_text),
          color = COALESCE($2, color),
          updated_at = NOW()
      WHERE note_id = $3 AND appointment_id = $4
      RETURNING note_id, note_text, color, updated_at
    `, [hasText ? text : null, hasColor ? color : null, noteId, appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Treatment note not found.' });
    return res.json(noteResponse(result.rows[0]));
  } catch (error) {
    console.error('Error updating treatment note:', error);
    return res.status(500).json({ message: 'Could not update treatment note.' });
  }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  const noteId = validNoteId(req.params.noteId);
  if (!appointmentId || !noteId) return res.status(400).json({ message: 'Choose a valid note.' });

  try {
    if (!(await getAssignedAppointment(appointmentId, req.session.userId))) {
      return res.status(403).json({ message: 'You cannot delete notes for this appointment.' });
    }

    const result = await db.query(
      'DELETE FROM treatment_notes WHERE note_id = $1 AND appointment_id = $2 RETURNING note_id',
      [noteId, appointmentId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Treatment note not found.' });
    return res.status(204).end();
  } catch (error) {
    console.error('Error deleting treatment note:', error);
    return res.status(500).json({ message: 'Could not delete treatment note.' });
  }
});

function calendarDayNumber(dateStr) {
  let [year, month, day] = dateStr.split('-').map(Number);
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100)
    + Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  return era * 146097 + dayOfEra;
}

function minutesUntil(dateStr, timeStr, now) {
  const [hour, minute] = timeStr.slice(0, 5).split(':').map(Number);
  const [nowHour, nowMinute] = now.timeStr.split(':').map(Number);
  return (calendarDayNumber(dateStr) - calendarDayNumber(now.dateStr)) * 1440 + (hour * 60 + minute) - (nowHour * 60 + nowMinute);
}

async function getValidatedBooking(userId, body, res) {
  const userResult = await db.query('SELECT user_id, email_verified, role FROM users WHERE user_id = $1', [userId]);
  if (userResult.rows.length === 0) {
    res.status(401).json({ message: 'Your session is no longer valid. Please log in again.' });
    return null;
  }
  const user = userResult.rows[0];
  if (!user.email_verified || user.role !== 'client') {
    res.status(403).json({ message: 'Only verified client accounts can book appointments.' });
    return null;
  }

  const serviceId = validServiceId(body.serviceId);
  const appointmentDate = normalizeDate(body.date);
  if (!serviceId) {
    res.status(400).json({ message: 'Choose a valid service.' });
    return null;
  }

  const serviceResult = await db.query(`SELECT service_id, service_name, duration_minutes, service_price, reservation_fee FROM services WHERE service_id = $1 AND is_active = TRUE`, [serviceId]);
  if (serviceResult.rows.length === 0) {
    res.status(404).json({ message: 'Service not found.' });
    return null;
  }
  const service = serviceResult.rows[0];

  if (!appointmentDate) {
    res.status(400).json({ message: 'Choose a valid appointment date.' });
    return null;
  }
  const now = manilaNow();
  if (appointmentDate < now.dateStr) {
    res.status(400).json({ message: 'Appointments cannot be booked in the past.' });
    return null;
  }
  if (appointmentDate > addCalendarDays(now.dateStr, MAX_ADVANCE_DAYS)) {
    res.status(400).json({ message: `Appointments can only be booked up to ${MAX_ADVANCE_DAYS} days in advance.` });
    return null;
  }
  if (CLOSED_WEEKDAYS.includes(weekday(appointmentDate))) {
    res.status(400).json({ message: 'The center is closed on the selected date.' });
    return null;
  }

  if (typeof body.time !== 'string' || !VALID_SLOTS.includes(body.time)) {
    res.status(400).json({ message: 'Choose an available appointment time.' });
    return null;
  }
  const appointmentTime = to24h(body.time);
  if (!appointmentTime || isSlotInPast(appointmentDate, appointmentTime)) {
    res.status(400).json({ message: 'Appointments cannot be booked in the past.' });
    return null;
  }
  if (isSlotTooSoon(appointmentDate, appointmentTime)) {
    res.status(400).json({ message: `Please choose a time at least ${MIN_BOOKING_LEAD_MINUTES} minutes from now.` });
    return null;
  }

  const appointmentEndTime = addMinutes(appointmentTime, Number(service.duration_minutes));
  if (!appointmentEndTime || appointmentEndTime > CLOSING_TIME) {
    res.status(400).json({ message: 'This service does not fit within the center’s operating hours at the selected time.' });
    return null;
  }

  return { user, service, appointmentDate, appointmentTime, appointmentEndTime };
}

async function findAvailableAestheticians(queryClient, booking) {
  const serviceResult = await queryClient.query('SELECT category FROM services WHERE service_id = $1', [booking.serviceId]);
  const staffRole = roleForCategory(serviceResult.rows[0]?.category);
  return queryClient.query(`
    SELECT u.user_id FROM users u
    WHERE u.role = $4 AND u.status = 'active' AND u.email_verified = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.aesthetician_id = u.user_id
          AND a.appointment_status IN ('confirmed', 'completed')
          AND tsrange(a.appointment_date + a.appointment_time, a.appointment_date + a.appointment_end_time) && tsrange($1::date + $2::time, $1::date + $3::time)
      )
    ORDER BY u.user_id
  `, [booking.appointmentDate, booking.appointmentTime, booking.appointmentEndTime, staffRole]);
}

async function createAppointmentFromPaidCheckout(client, payment, referenceNumber, paymentId = null, paymentMethod = null) {
  const requestedMethod = paymentMethod || payment.payment_method;
  const recordedMethod = ['paymongo', 'gcash', 'maya', 'card'].includes(requestedMethod) ? requestedMethod : 'paymongo';
  const candidates = await findAvailableAestheticians(client, {
    appointmentDate: payment.appointment_date,
    appointmentTime: payment.appointment_time,
    appointmentEndTime: payment.appointment_end_time,
    serviceId: payment.service_id,
  });

  for (const candidate of candidates.rows) {
    await client.query('SAVEPOINT appointment_candidate');
    try {
      const result = await client.query(`
        INSERT INTO appointments (user_id, service_id, booked_service_price, booked_reservation_fee, appointment_date, appointment_time, appointment_end_time, aesthetician_id, appointment_status, payment_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'paid')
        RETURNING appointment_id, appointment_status, payment_status, aesthetician_id
      `, [payment.user_id, payment.service_id, payment.service_price,
        Number(payment.amount_cents) / 100, payment.appointment_date,
        payment.appointment_time, payment.appointment_end_time, candidate.user_id]);
      await client.query(`
        INSERT INTO payments (appointment_id, payment_type, amount, method, reference_no, note)
        VALUES ($1, 'reservation', $2, $3, $4, 'PayMongo reservation deposit')
        ON CONFLICT (appointment_id)
          WHERE payment_type = 'reservation' AND appointment_id IS NOT NULL
        DO NOTHING
      `, [result.rows[0].appointment_id, Number(payment.amount_cents) / 100, recordedMethod, referenceNumber]);
      await client.query(`
        UPDATE paymongo_checkout_sessions
        SET status = 'consumed', appointment_id = $1, payment_id = COALESCE($3, payment_id),
            payment_method = $4, updated_at = NOW()
        WHERE reference_number = $2
      `, [result.rows[0].appointment_id, referenceNumber, paymentId, recordedMethod]);
      await client.query('RELEASE SAVEPOINT appointment_candidate');
      return result.rows[0];
    } catch (error) {
      if (error.code === '23P01' || error.code === '23505') {
        await client.query('ROLLBACK TO SAVEPOINT appointment_candidate');
        await client.query('RELEASE SAVEPOINT appointment_candidate');
        continue;
      }
      throw error;
    }
  }

  return null;
}

function validPaymentReference(value) {
  return typeof value === 'string' && /^SG[A-F0-9]{24}$/.test(value);
}

// Must stay before any future /:id GET route so "mine" is never treated as an ID.
router.get('/mine', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  try {
    const userResult = await db.query('SELECT role FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) return res.status(401).json({ message: 'Your session is no longer valid. Please log in again.' });

    const isAesthetician = ['aesthetician', 'nail_tech'].includes(userResult.rows[0].role);

    const appointmentsQuery = isAesthetician
      ? `
        SELECT a.appointment_id,
               a.appointment_date::text AS date,
               a.appointment_time::text AS start,
               a.appointment_end_time::text AS end,
               a.appointment_status AS status,
               a.payment_status,
               s.service_name AS service,
               a.booked_service_price AS fee,
               a.booked_reservation_fee AS deposit_amount,
               a.cancellation_request_status,
               a.cancellation_reason,
               a.cancellation_description,
               a.reschedule_request_status,
               a.reschedule_requested_date::text AS reschedule_requested_date,
               a.reschedule_requested_time::text AS reschedule_requested_time,
               a.reschedule_reason,
               a.reschedule_description,
               a.user_id AS client_id,
               COALESCE(CONCAT(c.first_name, ' ', c.last_name), 'Client') AS client,
               c.email AS client_email,
               COALESCE(CONCAT(aesthetician.first_name, ' ', aesthetician.last_name), 'Aesthetician') AS aesthetician,
               c.contact_number AS contact,
               NULL::text AS remarks,
               a.appointment_id AS apptNumber
        FROM appointments a
        JOIN services s ON s.service_id = a.service_id
        JOIN users c ON c.user_id = a.user_id
        JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
        WHERE a.aesthetician_id = $1
        ORDER BY a.appointment_date ASC, a.appointment_time ASC
      `
      : `
        SELECT a.appointment_id,
               a.appointment_date::text AS date,
               a.appointment_time::text AS start,
               a.appointment_end_time::text AS end,
               a.appointment_status AS status,
               a.payment_status,
               s.service_name AS service,
               a.booked_service_price AS fee,
               a.booked_reservation_fee AS deposit_amount,
               a.cancellation_request_status,
               a.cancellation_reason,
               a.cancellation_description,
               a.reschedule_request_status,
               a.reschedule_requested_date::text AS reschedule_requested_date,
               a.reschedule_requested_time::text AS reschedule_requested_time,
               a.reschedule_reason,
               a.reschedule_description,
               COALESCE(CONCAT(c.first_name, ' ', c.last_name), 'Client') AS client,
               COALESCE(CONCAT(aesthetician.first_name, ' ', aesthetician.last_name), 'Aesthetician') AS aesthetician,
               c.contact_number AS contact,
               NULL::text AS remarks,
               a.appointment_id AS apptNumber,
               ar.rating AS my_rating,
               ar.comment AS my_rating_comment
        FROM appointments a
        JOIN services s ON s.service_id = a.service_id
        JOIN users c ON c.user_id = a.user_id
        JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
        LEFT JOIN appointment_ratings ar ON ar.appointment_id = a.appointment_id
        WHERE a.user_id = $1
        ORDER BY a.appointment_date ASC, a.appointment_time ASC
      `;

    const result = await db.query(appointmentsQuery, [req.session.userId]);

    const appointments = result.rows.map((row) => ({
      ...row,
      id: row.appointment_id,
      date: row.date,
      start: row.start,
      end: row.end,
      status: row.status,
      service: row.service,
      client: row.client,
      aesthetician: row.aesthetician,
      hasRating: row.my_rating != null,
      myRating: row.my_rating,
      myRatingComment: row.my_rating_comment,
      fee: row.fee,
      depositAmount: row.deposit_amount,
      clientId: row.client_id,
      clientEmail: row.client_email,
      remarks: row.remarks,
      apptNumber: row.apptnumber || row.appointment_id,
      appointment_id: row.appointment_id,
      appointment_date: row.date,
      appointment_time: row.start,
      appointment_end_time: row.end,
      appointment_status: row.status,
      service_name: row.service,
      booked_service_price: row.fee,
      booked_reservation_fee: row.deposit_amount,
      cancellationRequestStatus: row.cancellation_request_status,
      cancellationReason: row.cancellation_reason,
      cancellationDescription: row.cancellation_description,
      rescheduleRequestStatus: row.reschedule_request_status,
      rescheduleRequestedDate: row.reschedule_requested_date,
      rescheduleRequestedTime: row.reschedule_requested_time,
      rescheduleReason: row.reschedule_reason,
      rescheduleDescription: row.reschedule_description
    }));

    return res.json(appointments);
  } catch (error) {
    console.error('Error fetching client appointments:', error);
    return res.status(500).json({ message: 'Could not load appointments.' });
  }
});

router.post('/:id/cancel', requireRole('admin'), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  try {
    const result = await db.query(`
            SELECT a.appointment_id, a.user_id, a.aesthetician_id,
              a.appointment_date::text AS appointment_date,
              a.appointment_time::text AS appointment_time, a.appointment_status, a.payment_status,
              s.service_name
            FROM appointments a
            JOIN services s ON s.service_id = a.service_id
            WHERE a.appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    if (appointment.appointment_status !== 'confirmed') return res.status(400).json({ message: 'Only confirmed appointments can be cancelled.' });
    const minutesToAppointment = minutesUntil(appointment.appointment_date, appointment.appointment_time, manilaNow());
    if (minutesToAppointment <= 0) return res.status(400).json({ message: 'Appointments that have already started cannot be cancelled.' });

    await db.query(`UPDATE appointments SET appointment_status = 'cancelled' WHERE appointment_id = $1`, [appointmentId]);

    // Cancellations made at least 24 hours ahead qualify for an automatic refund, per the Terms.
    let refundMessage = '';
    if (appointment.payment_status === 'paid' && minutesToAppointment >= 24 * 60) {
      const refundOutcome = await refundAppointmentDeposit(appointmentId);
      refundMessage = refundOutcome.refunded
        ? ' The reservation fee was automatically refunded.'
        : ' The reservation fee could not be refunded automatically; process it manually.';
    }

    const message = `Your ${appointment.service_name} appointment on ${appointment.appointment_date} at ${String(appointment.appointment_time).slice(0, 5)} was cancelled.${refundMessage}`;
    await notifyUsers([appointment.user_id, appointment.aesthetician_id].filter(Boolean), 'appointment_cancelled', message);
    await notifyRoles(['admin'], 'appointment_cancelled', message, { excludeUserIds: [req.session.userId] });
    return res.json({ message: `Appointment cancelled successfully.${refundMessage}` });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return res.status(500).json({ message: 'Could not cancel appointment.' });
  }
});

router.post('/:id/cancellation-request', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const reason = validRequestText(body.reason, 255);
  const description = validRequestText(body.description, 2000);
  if (!reason || !description) return res.status(400).json({ message: 'Reason and description are required.' });

  try {
    const result = await db.query(`
      SELECT appointment_id, aesthetician_id, user_id, appointment_status, cancellation_request_status
      FROM appointments WHERE appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });
    const appointment = result.rows[0];
    const isAssignedAesthetician = appointment.aesthetician_id === req.session.userId;
    const isClient = appointment.user_id === req.session.userId;
    if (!isAssignedAesthetician && !isClient) return res.status(403).json({ message: 'Only the assigned aesthetician or client can request cancellation.' });
    if (appointment.appointment_status !== 'confirmed') return res.status(400).json({ message: 'Only confirmed appointments can be cancelled.' });
    if (appointment.cancellation_request_status) return res.status(409).json({ message: 'A cancellation request has already been submitted for this appointment.' });

    await db.query(`
      UPDATE appointments
      SET cancellation_request_status = 'pending', cancellation_reason = $1,
          cancellation_description = $2, cancellation_requested_by = $3,
          cancellation_requested_at = NOW(), cancellation_reviewed_by = NULL,
          cancellation_reviewed_at = NULL
      WHERE appointment_id = $4
    `, [reason, description, req.session.userId, appointmentId]);
    const requestorRole = isClient ? 'Client' : 'Aesthetician';
    await notifyRoles(
      ['admin'],
      'cancellation_request',
      `${requestorRole} requested cancellation for appointment ${appointmentId}: ${reason}. ${description}`,
    );
    if (isClient && appointment.aesthetician_id) {
      await notifyUsers(
        [appointment.aesthetician_id],
        'cancellation_request',
        `Client requested cancellation for appointment ${appointmentId}: ${reason}.`,
      );
    }
    return res.json({ message: 'Cancellation request sent to the admin.' });
  } catch (error) {
    console.error('Error creating cancellation request:', error);
    return res.status(500).json({ message: 'Could not send cancellation request.' });
  }
});

router.post('/:id/cancellation-request/review', requireRole('admin'), async (req, res) => {
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });
  const decision = req.body && req.body.decision;
  const requestType = req.body && req.body.requestType;
  if (!['allow', 'reject'].includes(decision)) return res.status(400).json({ message: 'Choose allow or reject.' });
  if (!['cancellation', 'reschedule'].includes(requestType)) return res.status(400).json({ message: 'Choose a valid request type.' });

  try {
    const result = await db.query(`
                  SELECT appointment_status, service_id, user_id, aesthetician_id, payment_status,
                    cancellation_request_status, reschedule_request_status,
                    reschedule_requested_date, reschedule_requested_time,
                    reschedule_requested_end_time
      FROM appointments WHERE appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });
    const appointment = result.rows[0];
    const requestStatus = requestType === 'cancellation' ? appointment.cancellation_request_status : appointment.reschedule_request_status;
    if (requestStatus !== 'pending') return res.status(400).json({ message: 'This request is no longer pending.' });

    if (requestType === 'reschedule' && decision === 'allow') {
      await db.query(`
        UPDATE appointments
        SET appointment_date = reschedule_requested_date,
            appointment_time = reschedule_requested_time,
            appointment_end_time = reschedule_requested_end_time,
          reminder_24h_sent = FALSE, reminder_3h_sent = FALSE,
            reschedule_request_status = 'approved', reschedule_reviewed_by = $1,
            reschedule_reviewed_at = NOW()
        WHERE appointment_id = $2
      `, [req.session.userId, appointmentId]);
    } else if (requestType === 'reschedule') {
      await db.query(`
        UPDATE appointments
        SET reschedule_request_status = 'rejected', reschedule_reviewed_by = $1,
            reschedule_reviewed_at = NOW()
        WHERE appointment_id = $2
      `, [req.session.userId, appointmentId]);
    } else {
      const nextStatus = decision === 'allow' ? 'cancelled' : appointment.appointment_status;
      await db.query(`
        UPDATE appointments
        SET appointment_status = $1, cancellation_request_status = $2,
            cancellation_reviewed_by = $3, cancellation_reviewed_at = NOW()
        WHERE appointment_id = $4
      `, [nextStatus, decision === 'allow' ? 'approved' : 'rejected', req.session.userId, appointmentId]);
    }
    if (decision === 'allow' && requestType === 'cancellation') {
      // The aesthetician initiated this cancellation, so the client is refunded regardless of the 24-hour window.
      if (appointment.payment_status === 'paid') {
        await refundAppointmentDeposit(appointmentId);
      }
      await notifyUsers(
        [appointment.user_id, appointment.aesthetician_id].filter(Boolean),
        'appointment_cancelled',
        `Appointment ${appointmentId} was cancelled after admin review.`,
      );
    } else if (decision === 'allow' && requestType === 'reschedule') {
      await notifyUsers(
        [appointment.user_id, appointment.aesthetician_id].filter(Boolean),
        'appointment_rescheduled',
        `Appointment ${appointmentId} was rescheduled to ${appointment.reschedule_requested_date} at ${String(appointment.reschedule_requested_time).slice(0, 5)}.`,
      );
    }
    const label = requestType === 'reschedule' ? 'Reschedule' : 'Cancellation';
    return res.json({ message: decision === 'allow' ? `${label} allowed.` : `${label} request rejected.` });
  } catch (error) {
    console.error('Error reviewing cancellation request:', error);
    return res.status(500).json({ message: 'Could not review cancellation request.' });
  }
});

router.post('/:id/finish', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });
  try {
    const result = await db.query(`
      SELECT appointment_date::text AS appointment_date, appointment_status
      FROM appointments
      WHERE appointment_id = $1 AND aesthetician_id = $2
    `, [appointmentId, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });
    if (result.rows[0].appointment_date !== manilaNow().dateStr) return res.status(400).json({ message: 'An appointment can only be finished on its scheduled date.' });
    if (result.rows[0].appointment_status !== 'confirmed') return res.status(400).json({ message: 'Only confirmed appointments can be finished.' });
    const updated = await db.query(`
      UPDATE appointments
      SET appointment_status = 'completed'
      WHERE appointment_id = $1 AND aesthetician_id = $2 AND appointment_status = 'confirmed'
      RETURNING user_id, appointment_id
    `, [appointmentId, req.session.userId]);
    if (updated.rows.length === 0) return res.status(409).json({ message: 'This appointment is no longer confirmed.' });
    await notifyUser(
      updated.rows[0].user_id,
      'appointment_status_changed',
      `Appointment ${updated.rows[0].appointment_id} status changed to completed.`,
    );
    await notifyUser(
      updated.rows[0].user_id,
      'rating_request',
      'How was your visit? Tap to rate it.',
      { email: false },
    );
    return res.json({ message: 'Appointment marked as completed.' });
  } catch (error) {
    console.error('Error finishing appointment:', error);
    return res.status(500).json({ message: 'Could not finish appointment.' });
  }
});

router.post('/:id/rating', ratingLimiter, async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const rating = validRatingValue(body.rating);
  const commentResult = validRatingComment(body.comment);
  if (!rating) return res.status(400).json({ message: 'Choose a rating between 1 and 5.' });
  if (!commentResult.ok) return res.status(400).json({ message: 'Comment must be 1000 characters or fewer.' });

  try {
    const result = await db.query(`
      SELECT appointment_id, user_id, aesthetician_id, service_id, appointment_status
      FROM appointments
      WHERE appointment_id = $1 AND user_id = $2
    `, [appointmentId, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    if (appointment.appointment_status !== 'completed') {
      return res.status(400).json({ message: 'Only completed appointments can be rated.' });
    }
    if (!appointment.aesthetician_id) {
      return res.status(400).json({ message: 'This appointment has no assigned staff member to rate.' });
    }

    const withinWindow = await db.query(`
      SELECT appointment_date::text AS appointment_date
      FROM appointments WHERE appointment_id = $1
    `, [appointmentId]);
    const daysSinceCompletion = Math.floor(
      (Date.parse(manilaNow().dateStr) - Date.parse(withinWindow.rows[0].appointment_date)) / (24 * 60 * 60 * 1000),
    );
    if (daysSinceCompletion > RATING_WINDOW_DAYS) {
      return res.status(400).json({ message: `Ratings can only be submitted within ${RATING_WINDOW_DAYS} days of your visit.` });
    }

    const inserted = await db.query(`
      INSERT INTO appointment_ratings (appointment_id, client_id, staff_id, service_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING rating_id, rating, comment, created_at
    `, [appointmentId, req.session.userId, appointment.aesthetician_id, appointment.service_id, rating, commentResult.value]);

    await notifyUser(
      appointment.aesthetician_id,
      'rating_received',
      `You received a new ${rating}★ rating.`,
    );
    return res.status(201).json({ message: 'Thanks for your feedback!', rating: inserted.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'You already rated this appointment.' });
    console.error('Error submitting rating:', error);
    return res.status(500).json({ message: 'Could not submit your rating.' });
  }
});

router.post('/:id/no-show', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });
  try {
    const result = await db.query(`
      UPDATE appointments
      SET appointment_status = 'no_show'
      WHERE appointment_id = $1 AND aesthetician_id = $2
        AND appointment_status = 'confirmed'
        AND appointment_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
        AND appointment_time <= (NOW() AT TIME ZONE 'Asia/Manila')::time
      RETURNING user_id, appointment_id
    `, [appointmentId, req.session.userId]);
    if (result.rows.length === 0) {
      return res.status(409).json({ message: 'Only a confirmed appointment that has started today can be marked as no show.' });
    }
    await notifyUser(
      result.rows[0].user_id,
      'appointment_status_changed',
      `Appointment ${result.rows[0].appointment_id} status changed to no show.`,
    );
    return res.json({ message: 'Appointment marked as no show.' });
  } catch (error) {
    console.error('Error marking appointment no show:', error);
    return res.status(500).json({ message: 'Could not mark appointment as no show.' });
  }
});

router.post('/:id/reschedule', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const appointmentDate = normalizeDate(body.date);
  const appointmentTime = typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null;
  const slotLabel = appointmentTime ? from24h(appointmentTime) : null;
  if (!appointmentDate || !appointmentTime || !VALID_SLOTS.includes(slotLabel)) {
    return res.status(400).json({ message: 'Choose a valid date and available appointment time.' });
  }

  try {
    const result = await db.query(`
            SELECT a.appointment_id, a.user_id, a.aesthetician_id, a.service_id,
              a.appointment_status, a.reschedule_request_status, s.duration_minutes,
              s.service_name
      FROM appointments a
      JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    const userResult = await db.query('SELECT role FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) return res.status(401).json({ message: 'Your session is no longer valid.' });
    const isAdmin = userResult.rows[0].role === 'admin';
    const isAssignedAesthetician = ['aesthetician', 'nail_tech'].includes(userResult.rows[0].role)
      && appointment.aesthetician_id === req.session.userId;
    const isClient = appointment.user_id === req.session.userId;
    if (!isAdmin && !isAssignedAesthetician && !isClient) {
      return res.status(403).json({ message: 'Only an admin, the assigned aesthetician, or client can reschedule this appointment.' });
    }
    if (appointment.appointment_status !== 'confirmed') {
      return res.status(400).json({ message: 'Only confirmed appointments can be rescheduled.' });
    }
    const reason = validRequestText(body.reason, 255);
    const description = validRequestText(body.description, 2000);
    if ((isAssignedAesthetician || isClient) && appointment.reschedule_request_status) {
      return res.status(409).json({ message: 'A reschedule request has already been submitted for this appointment.' });
    }
    if ((isAssignedAesthetician || isClient) && (!reason || !description)) {
      return res.status(400).json({ message: 'Reason and description are required for a reschedule request.' });
    }

    const now = manilaNow();
    if (appointmentDate < now.dateStr || appointmentDate > addCalendarDays(now.dateStr, MAX_ADVANCE_DAYS)) {
      return res.status(400).json({ message: `Choose a date within the next ${MAX_ADVANCE_DAYS} days.` });
    }
    if (CLOSED_WEEKDAYS.includes(weekday(appointmentDate))) return res.status(400).json({ message: 'The center is closed on the selected date.' });
    if (isSlotInPast(appointmentDate, appointmentTime) || isSlotTooSoon(appointmentDate, appointmentTime)) {
      return res.status(400).json({ message: `Choose a time at least ${MIN_BOOKING_LEAD_MINUTES} minutes from now.` });
    }

    const appointmentEndTime = addMinutes(appointmentTime, Number(appointment.duration_minutes));
    if (!appointmentEndTime || appointmentEndTime > CLOSING_TIME) {
      return res.status(400).json({ message: 'This service does not fit within operating hours at the selected time.' });
    }

    if (isAssignedAesthetician || isClient) {
      await db.query(`
        UPDATE appointments
        SET reschedule_request_status = 'pending', reschedule_requested_date = $1,
            reschedule_requested_time = $2, reschedule_requested_end_time = $3,
            reschedule_reason = $4, reschedule_description = $5,
            reschedule_requested_by = $6, reschedule_requested_at = NOW(),
            reschedule_reviewed_by = NULL, reschedule_reviewed_at = NULL
        WHERE appointment_id = $7
      `, [appointmentDate, appointmentTime, appointmentEndTime, reason, description, req.session.userId, appointmentId]);
      const requestorRole = isClient ? 'Client' : 'Aesthetician';
      await notifyRoles(
        ['admin'],
        'reschedule_request',
        `${requestorRole} requested reschedule for appointment ${appointmentId} to ${appointmentDate} at ${slotLabel}: ${reason}.`,
      );
      if (isClient && appointment.aesthetician_id) {
        await notifyUsers(
          [appointment.aesthetician_id],
          'reschedule_request',
          `Client requested reschedule for appointment ${appointmentId} to ${appointmentDate} at ${slotLabel}.`,
        );
      }
      return res.json({ message: 'Reschedule request sent to the admin.' });
    }

    await db.query(`
      UPDATE appointments
        SET appointment_date = $1, appointment_time = $2, appointment_end_time = $3,
          reminder_24h_sent = FALSE, reminder_3h_sent = FALSE
      WHERE appointment_id = $4
    `, [appointmentDate, appointmentTime, appointmentEndTime, appointmentId]);
    await notifyUsers(
      [appointment.user_id, appointment.aesthetician_id].filter((userId) => userId && userId !== req.session.userId),
      'appointment_rescheduled',
      `${appointment.service_name} was rescheduled to ${appointmentDate} at ${slotLabel}.`,
    );
    return res.json({ message: 'Appointment rescheduled successfully.' });
  } catch (error) {
    if (error.code === '23P01' || error.code === '23505') {
      return res.status(409).json({ message: 'That time is no longer available. Choose another slot.' });
    }
    console.error('Error rescheduling appointment:', error);
    return res.status(500).json({ message: 'Could not reschedule appointment.' });
  }
});

router.post('/paymongo/checkout-session', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const config = getPayMongoConfig();
  if (!config) return res.status(503).json({ message: 'PayMongo is not configured for this environment.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  let referenceNumber;
  try {
    const booking = await getValidatedBooking(req.session.userId, body, res);
    if (!booking) return;

    const amountCents = Math.round(Number(booking.service.reservation_fee) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ message: 'This service has an invalid reservation fee.' });
    }
    const availableAestheticians = await findAvailableAestheticians(db, { ...booking, serviceId: booking.service.service_id });
    if (availableAestheticians.rows.length === 0) {
      return res.status(409).json({ message: 'That time slot is no longer available. Choose another time.' });
    }

    let baseUrl;
    try {
      baseUrl = new URL(process.env.APP_BASE_URL);
    } catch (error) {
      return res.status(503).json({ message: 'Set a valid APP_BASE_URL before starting checkout.' });
    }
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname);
    if (baseUrl.protocol !== 'https:' && !(config.mode === 'test' && localHost && baseUrl.protocol === 'http:')) {
      return res.status(503).json({ message: 'APP_BASE_URL must use HTTPS for live checkout.' });
    }

    const configuredMethods = (process.env.PAYMONGO_PAYMENT_METHODS || 'card,gcash,paymaya,qrph')
      .split(',').map((method) => method.trim()).filter(Boolean);
    if (configuredMethods.length === 0 || configuredMethods.some((method) => !/^[a-z0-9_]+$/.test(method))) {
      return res.status(503).json({ message: 'Configure valid PayMongo payment methods.' });
    }

    referenceNumber = `SG${randomBytes(12).toString('hex').toUpperCase()}`;
    await db.query(`
      INSERT INTO paymongo_checkout_sessions
        (reference_number, user_id, service_id, service_name, service_price,
         appointment_date, appointment_time, appointment_end_time, amount_cents,
         currency, status, livemode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PHP', 'pending', $10)
    `, [referenceNumber, booking.user.user_id, booking.service.service_id, booking.service.service_name,
      booking.service.service_price, booking.appointmentDate, booking.appointmentTime,
      booking.appointmentEndTime, amountCents, config.isLive]);

    const attributes = {
      line_items: [{
        name: booking.service.service_name,
        amount: amountCents,
        currency: 'PHP',
        quantity: 1
      }],
      payment_method_types: configuredMethods,
      success_url: checkoutReturnUrl(baseUrl, 'success', referenceNumber),
      cancel_url: checkoutReturnUrl(baseUrl, 'cancelled', referenceNumber),
      reference_number: referenceNumber,
      send_email_receipt: true
    };

    const payMongoResponse = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { attributes } })
    });
    const payMongoData = await payMongoResponse.json().catch(() => ({}));
    const checkoutSession = payMongoData.data;
    const checkoutUrl = checkoutSession?.attributes?.checkout_url;
    const sessionIsLive = checkoutSession?.attributes?.livemode;
    let parsedCheckoutUrl;
    try {
      parsedCheckoutUrl = new URL(checkoutUrl);
    } catch (error) {
      parsedCheckoutUrl = null;
    }

    if (!payMongoResponse.ok || !checkoutSession?.id || !parsedCheckoutUrl
      || parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.hostname !== 'checkout.paymongo.com'
      || sessionIsLive !== config.isLive) {
      await db.query(`UPDATE paymongo_checkout_sessions SET status = 'failed', updated_at = NOW() WHERE reference_number = $1`, [referenceNumber]);
      console.error('PayMongo checkout creation failed:', payMongoResponse.status, payMongoData.errors || 'Invalid checkout response');
      return res.status(502).json({ message: 'PayMongo could not start checkout. Please try again.' });
    }

    await db.query(`
      UPDATE paymongo_checkout_sessions
      SET checkout_session_id = $1, updated_at = NOW()
      WHERE reference_number = $2
    `, [checkoutSession.id, referenceNumber]);

    return res.status(201).json({
      referenceNumber,
      checkoutUrl,
      amount: amountCents / 100,
      currency: 'PHP'
    });
  } catch (error) {
    if (referenceNumber) {
      await db.query(`UPDATE paymongo_checkout_sessions SET status = 'failed', updated_at = NOW() WHERE reference_number = $1 AND status = 'pending'`, [referenceNumber]).catch(() => {});
    }
    console.error('Error creating PayMongo checkout:', error.message);
    return res.status(500).json({ message: 'Could not start PayMongo checkout.' });
  }
});

router.get('/paymongo/status/:referenceNumber', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const { referenceNumber } = req.params;
  if (!validPaymentReference(referenceNumber)) return res.status(400).json({ message: 'Choose a valid checkout reference.' });

  try {
    const result = await db.query(`
      SELECT status, amount_cents, currency, appointment_id
      FROM paymongo_checkout_sessions
      WHERE reference_number = $1 AND user_id = $2
    `, [referenceNumber, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Checkout session not found.' });
    const checkout = result.rows[0];
    return res.json({
      status: checkout.status,
      amount: Number(checkout.amount_cents) / 100,
      currency: checkout.currency,
      appointmentId: checkout.appointment_id
    });
  } catch (error) {
    console.error('Error fetching checkout status:', error.message);
    return res.status(500).json({ message: 'Could not check payment status.' });
  }
});

router.post('/paymongo/confirm', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const referenceNumber = body.referenceNumber;
  if (!validPaymentReference(referenceNumber)) return res.status(400).json({ message: 'Choose a valid checkout reference.' });

  let payment;
  try {
    const paymentResult = await db.query(`
      SELECT reference_number, user_id, service_id, appointment_date::text AS appointment_date,
              appointment_time::text AS appointment_time, appointment_end_time::text AS appointment_end_time,
              service_name, service_price, amount_cents, currency, status,
             checkout_session_id, appointment_id, livemode, payment_id
      FROM paymongo_checkout_sessions
      WHERE reference_number = $1 AND user_id = $2
    `, [referenceNumber, req.session.userId]);
    if (paymentResult.rows.length === 0) return res.status(404).json({ message: 'Checkout session not found.' });
    payment = paymentResult.rows[0];

    if (payment.status === 'consumed' && payment.appointment_id) {
      return res.json({ message: 'Appointment already created.', appointment: { appointment_id: payment.appointment_id } });
    }
    if (payment.status !== 'paid') {
      return res.status(409).json({ pending: payment.status === 'pending', message: payment.status === 'pending' ? 'Payment is still being verified.' : 'Payment was not completed.' });
    }

    const config = getPayMongoConfig();
    if (!config || payment.livemode !== config.isLive) {
      return res.status(503).json({ message: 'PayMongo mode does not match this checkout.' });
    }
    if (payment.currency !== 'PHP' || isSlotInPast(payment.appointment_date, payment.appointment_time.slice(0, 5))) {
      return res.status(409).json({ message: 'Payment was received after this appointment time. Contact support to arrange a refund.' });
    }

    const appointment = await db.transaction(async (client) => {
      const lockedPayment = await client.query(`
        SELECT status, appointment_id, user_id, service_id, service_name, service_price,
               appointment_date::text AS appointment_date,
               appointment_time::text AS appointment_time,
               appointment_end_time::text AS appointment_end_time,
               amount_cents, payment_id, payment_method
        FROM paymongo_checkout_sessions
        WHERE reference_number = $1 AND user_id = $2
        FOR UPDATE
      `, [referenceNumber, req.session.userId]);
      if (lockedPayment.rows.length === 0) throw new Error('Checkout session not found.');
      if (lockedPayment.rows[0].status === 'consumed' && lockedPayment.rows[0].appointment_id) {
        return { appointment_id: lockedPayment.rows[0].appointment_id, alreadyCreated: true };
      }
      if (lockedPayment.rows[0].status !== 'paid') {
        const error = new Error('Payment is still being verified.');
        error.code = 'PAYMENT_NOT_PAID';
        throw error;
      }

      const created = await createAppointmentFromPaidCheckout(client, lockedPayment.rows[0], referenceNumber, lockedPayment.rows[0].payment_id, lockedPayment.rows[0].payment_method);
      if (!created) {
        const error = new Error('That time slot was just taken. Your payment was received, but no appointment was created. Contact support to arrange a refund.');
        error.code = 'SLOT_UNAVAILABLE';
        throw error;
      }
      return { ...created, alreadyCreated: false };
    });

    if (!appointment.alreadyCreated) {
      const message = `Your ${payment.service_name} appointment on ${payment.appointment_date} at ${String(payment.appointment_time).slice(0, 5)} is confirmed.`;
      await notifyUser(payment.user_id, 'appointment_confirmed', message);
      await notifyUser(
        appointment.aesthetician_id,
        'appointment_confirmed',
        `New appointment: ${payment.service_name} on ${payment.appointment_date} at ${String(payment.appointment_time).slice(0, 5)}.`,
      );
    }

    return res.status(201).json({
      message: 'Appointment created successfully.',
      appointment: {
        appointment_id: appointment.appointment_id,
        service_name: payment.service_name,
        appointment_date: payment.appointment_date,
        appointment_time: payment.appointment_time,
        appointment_status: appointment.appointment_status || 'confirmed',
        payment_status: appointment.payment_status || 'paid'
      }
    });
  } catch (error) {
    if (error.code === 'PAYMENT_NOT_PAID') return res.status(409).json({ pending: true, message: error.message });
    if (error.code === 'SLOT_UNAVAILABLE' || error.code === '23P01' || error.code === '23505') {
      const refundOutcome = payment
        ? await attemptCheckoutRefund(referenceNumber, payment.amount_cents, payment.payment_id, 'duplicate')
        : { refunded: false };
      const message = refundOutcome.refunded
        ? 'That time slot was just taken by another booking. Your payment has been automatically refunded.'
        : `Payment was received for checkout ${referenceNumber}, but no appointment slot could be secured. Contact support urgently to arrange a refund.`;
      await notifyUser(req.session.userId, 'payment_slot_unavailable', message);
      await notifyRoles(['admin'], 'payment_slot_unavailable', message);
      return res.status(409).json({ message });
    }
    console.error('Error confirming paid appointment:', error.message);
    return res.status(500).json({ message: 'Could not confirm your paid appointment.' });
  }
});

router.post('/paymongo/webhook', async (req, res) => {
  const config = getPayMongoConfig();
  if (!config) return res.status(503).json({ message: 'PayMongo is not configured for this environment.' });
  if (!payMongoSignatureIsValid(req.get('Paymongo-Signature'), req.body, config)) {
    return res.status(401).json({ message: 'Invalid PayMongo webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    return res.status(400).json({ message: 'Invalid webhook payload.' });
  }

  const eventAttributes = event?.data?.attributes;
  if (eventAttributes?.type !== 'checkout_session.payment.paid') return res.sendStatus(200);
  const session = eventAttributes.data;
  const attributes = session?.attributes;
  const referenceNumber = attributes?.reference_number;
  if (!validPaymentReference(referenceNumber) || !session?.id) return res.status(400).json({ message: 'Invalid checkout payment event.' });
  if (Boolean(eventAttributes.livemode) !== config.isLive) return res.status(400).json({ message: 'Webhook mode does not match configuration.' });

  const paidPayment = Array.isArray(attributes.payments)
    ? attributes.payments.find((item) => item?.attributes?.status === 'paid')
    : null;
  const lineItems = Array.isArray(attributes.line_items) ? attributes.line_items : [];
  const sessionAmount = lineItems.reduce((total, item) => total + Number(item.amount) * Number(item.quantity || 1), 0);
  const paymentAttributes = paidPayment?.attributes;
  if (!paymentAttributes || paymentAttributes.currency !== 'PHP'
    || Number(paymentAttributes.amount) !== sessionAmount || !Number.isSafeInteger(sessionAmount)) {
    return res.status(400).json({ message: 'Checkout payment details are incomplete.' });
  }
  const paymentMethod = financeMethodForPayMongo(paymentAttributes);

  try {
    const outcome = await db.transaction(async (client) => {
      const paymentResult = await client.query(`
        SELECT reference_number, user_id, service_id, service_name, service_price,
               appointment_date::text AS appointment_date,
               appointment_time::text AS appointment_time,
               appointment_end_time::text AS appointment_end_time,
               amount_cents, status, appointment_id, payment_method
        FROM paymongo_checkout_sessions
        WHERE reference_number = $1 AND checkout_session_id = $2 AND livemode = $3
          AND amount_cents = $4 AND currency = 'PHP'
        FOR UPDATE
      `, [referenceNumber, session.id, config.isLive, sessionAmount]);
      if (paymentResult.rows.length === 0) return { type: 'unmatched' };

      const payment = paymentResult.rows[0];
      if (payment.status === 'consumed') {
        await client.query(`
          UPDATE paymongo_checkout_sessions
          SET payment_id = COALESCE(payment_id, $2), payment_method = $3, updated_at = NOW()
          WHERE reference_number = $1
        `, [referenceNumber, paidPayment.id, paymentMethod]);
        await client.query(`
          UPDATE payments SET method = $1
          WHERE appointment_id = $2 AND payment_type = 'reservation'
        `, [paymentMethod, payment.appointment_id]);
        return { type: 'already-created' };
      }
      if (!['pending', 'paid'].includes(payment.status)) return { type: 'ignored' };
      await client.query(`
        UPDATE paymongo_checkout_sessions
        SET payment_id = COALESCE(payment_id, $2), payment_method = $3, updated_at = NOW()
        WHERE reference_number = $1
      `, [referenceNumber, paidPayment.id, paymentMethod]);
      if (isSlotInPast(payment.appointment_date, String(payment.appointment_time).slice(0, 5))) {
        if (payment.status === 'pending') {
          await client.query(`
            UPDATE paymongo_checkout_sessions
            SET status = 'paid', payment_id = $2, payment_method = $3, updated_at = NOW()
            WHERE reference_number = $1 AND status = 'pending'
          `, [referenceNumber, paidPayment.id, paymentMethod]);
          return { type: 'late-payment', payment };
        }
        return { type: 'ignored' };
      }

      const appointment = await createAppointmentFromPaidCheckout(client, payment, referenceNumber, paidPayment.id, paymentMethod);
      if (appointment) return { type: 'created', payment, appointment };

      await client.query(`
        UPDATE paymongo_checkout_sessions
        SET status = 'paid', payment_id = $2, payment_method = $3, updated_at = NOW()
        WHERE reference_number = $1 AND status = 'pending'
      `, [referenceNumber, paidPayment.id, paymentMethod]);
      return { type: 'slot-unavailable', payment };
    });

    if (outcome.type === 'unmatched') console.warn('Ignoring unmatched PayMongo checkout event.');
    if (outcome.type === 'created') {
      const { payment, appointment } = outcome;
      const message = `Your ${payment.service_name} appointment on ${payment.appointment_date} at ${String(payment.appointment_time).slice(0, 5)} is confirmed.`;
      await notifyUser(payment.user_id, 'appointment_confirmed', message);
      await notifyUser(
        appointment.aesthetician_id,
        'appointment_confirmed',
        `New appointment: ${payment.service_name} on ${payment.appointment_date} at ${String(payment.appointment_time).slice(0, 5)}.`,
      );
    } else if (outcome.type === 'slot-unavailable') {
      const refundOutcome = await attemptCheckoutRefund(referenceNumber, outcome.payment.amount_cents, paidPayment.id, 'duplicate');
      const message = refundOutcome.refunded
        ? `Payment for checkout ${referenceNumber} was automatically refunded because the time slot was already booked.`
        : `Payment was received for checkout ${referenceNumber}, but no appointment slot could be secured. Contact support urgently to arrange a refund.`;
      await notifyUser(outcome.payment.user_id, 'payment_slot_unavailable', message);
      await notifyRoles(['admin'], 'payment_slot_unavailable', message);
    } else if (outcome.type === 'late-payment') {
      const refundOutcome = await attemptCheckoutRefund(referenceNumber, outcome.payment.amount_cents, paidPayment.id, 'others');
      const message = refundOutcome.refunded
        ? `Payment for checkout ${referenceNumber} was automatically refunded because it arrived after the appointment start time.`
        : `Payment was received for checkout ${referenceNumber} after the appointment start time. Contact support urgently to arrange a refund.`;
      await notifyUser(outcome.payment.user_id, 'payment_slot_unavailable', message);
      await notifyRoles(['admin'], 'payment_slot_unavailable', message);
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('Error processing PayMongo webhook:', error.message);
    return res.status(500).json({ message: 'Could not process payment notification.' });
  }
});

router.post('/', async (req, res) => {
  return res.status(402).json({ message: 'Create an appointment only after a verified PayMongo payment.' });
});

module.exports = router;
