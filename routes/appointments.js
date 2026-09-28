const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { createHmac, randomBytes, timingSafeEqual } = require('crypto');
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

async function markPastPendingAppointments() {
  await db.query(`
    UPDATE appointments
    SET appointment_status = 'no_show'
    WHERE appointment_status = 'pending'
      AND appointment_date + appointment_end_time < (NOW() AT TIME ZONE 'Asia/Manila')
  `);
}

router.get('/admin', requireRole('admin'), async (req, res) => {
  try {
    await markPastPendingAppointments();
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

function findAvailableAestheticians(queryClient, booking) {
  return queryClient.query(`
    SELECT u.user_id FROM users u
    WHERE u.role = 'aesthetician' AND u.status = 'active' AND u.email_verified = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.aesthetician_id = u.user_id
          AND a.appointment_status IN ('pending', 'confirmed', 'completed')
          AND tsrange(a.appointment_date + a.appointment_time, a.appointment_date + a.appointment_end_time) && tsrange($1::date + $2::time, $1::date + $3::time)
      )
    ORDER BY u.user_id
  `, [booking.appointmentDate, booking.appointmentTime, booking.appointmentEndTime]);
}

function validPaymentReference(value) {
  return typeof value === 'string' && /^SG[A-F0-9]{24}$/.test(value);
}

// Must stay before any future /:id GET route so "mine" is never treated as an ID.
router.get('/mine', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  try {
    await markPastPendingAppointments();
    const userResult = await db.query('SELECT role FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) return res.status(401).json({ message: 'Your session is no longer valid. Please log in again.' });

    const isAesthetician = userResult.rows[0].role === 'aesthetician';

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
               COALESCE(CONCAT(c.first_name, ' ', c.last_name), 'Client') AS client,
               COALESCE(CONCAT(aesthetician.first_name, ' ', aesthetician.last_name), 'Aesthetician') AS aesthetician,
               c.contact_number AS contact,
               NULL::text AS remarks,
               a.appointment_id AS apptNumber
        FROM appointments a
        JOIN services s ON s.service_id = a.service_id
        JOIN users c ON c.user_id = a.user_id
        JOIN users aesthetician ON aesthetician.user_id = a.aesthetician_id
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
      booked_reservation_fee: row.deposit_amount
    }));

    return res.json(appointments);
  } catch (error) {
    console.error('Error fetching client appointments:', error);
    return res.status(500).json({ message: 'Could not load appointments.' });
  }
});

router.post('/:id/cancel', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });
  const appointmentId = validAppointmentId(req.params.id);
  if (!appointmentId) return res.status(400).json({ message: 'Choose a valid appointment.' });

  try {
    const result = await db.query(`
      SELECT appointment_id, user_id, aesthetician_id, appointment_date::text AS appointment_date,
             appointment_time::text AS appointment_time, appointment_status
      FROM appointments
      WHERE appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    const isClient = appointment.user_id === req.session.userId;
    const isAssignedAesthetician = appointment.aesthetician_id === req.session.userId;
    if (!isClient && !isAssignedAesthetician) return res.status(403).json({ message: 'You cannot cancel this appointment.' });
    if (isAssignedAesthetician && !isClient) return res.status(400).json({ message: 'Aesthetician cancellations require an admin-approved cancellation request.' });
    if (!['pending', 'confirmed'].includes(appointment.appointment_status)) return res.status(400).json({ message: 'Only pending or confirmed appointments can be cancelled.' });
    const minutesToAppointment = minutesUntil(appointment.appointment_date, appointment.appointment_time, manilaNow());
    if (minutesToAppointment <= 0) return res.status(400).json({ message: 'Appointments that have already started cannot be cancelled.' });
    if (isClient && minutesToAppointment < 24 * 60) return res.status(400).json({ message: 'Appointments can only be cancelled at least 24 hours in advance.' });

    await db.query(`UPDATE appointments SET appointment_status = 'cancelled' WHERE appointment_id = $1`, [appointmentId]);
    return res.json({ message: 'Appointment cancelled successfully.' });
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
      SELECT appointment_id, aesthetician_id, appointment_status, cancellation_request_status
      FROM appointments WHERE appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });
    const appointment = result.rows[0];
    if (appointment.aesthetician_id !== req.session.userId) return res.status(403).json({ message: 'Only the assigned aesthetician can request cancellation.' });
    if (!['pending', 'confirmed'].includes(appointment.appointment_status)) return res.status(400).json({ message: 'Only pending or confirmed appointments can be cancelled.' });
    if (appointment.cancellation_request_status) return res.status(409).json({ message: 'A cancellation request has already been submitted for this appointment.' });

    await db.query(`
      UPDATE appointments
      SET cancellation_request_status = 'pending', cancellation_reason = $1,
          cancellation_description = $2, cancellation_requested_by = $3,
          cancellation_requested_at = NOW(), cancellation_reviewed_by = NULL,
          cancellation_reviewed_at = NULL
      WHERE appointment_id = $4
    `, [reason, description, req.session.userId, appointmentId]);
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
      SELECT appointment_status, service_id, cancellation_request_status,
             reschedule_request_status, reschedule_requested_date,
             reschedule_requested_time, reschedule_requested_end_time
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
    if (!['pending', 'confirmed'].includes(result.rows[0].appointment_status)) return res.status(400).json({ message: 'Only pending or confirmed appointments can be finished.' });
    await db.query(`UPDATE appointments SET appointment_status = 'completed' WHERE appointment_id = $1`, [appointmentId]);
    return res.json({ message: 'Appointment marked as completed.' });
  } catch (error) {
    console.error('Error finishing appointment:', error);
    return res.status(500).json({ message: 'Could not finish appointment.' });
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
              a.appointment_status, a.reschedule_request_status, s.duration_minutes
      FROM appointments a
      JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    if (appointment.user_id !== req.session.userId && appointment.aesthetician_id !== req.session.userId) {
      return res.status(403).json({ message: 'You cannot reschedule this appointment.' });
    }
    if (!['pending', 'confirmed'].includes(appointment.appointment_status)) {
      return res.status(400).json({ message: 'Only pending or confirmed appointments can be rescheduled.' });
    }
    const isAssignedAesthetician = appointment.aesthetician_id === req.session.userId;
    const reason = validRequestText(body.reason, 255);
    const description = validRequestText(body.description, 2000);
    if (isAssignedAesthetician && appointment.reschedule_request_status) {
      return res.status(409).json({ message: 'A reschedule request has already been submitted for this appointment.' });
    }
    if (isAssignedAesthetician && (!reason || !description)) {
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

    if (isAssignedAesthetician) {
      await db.query(`
        UPDATE appointments
        SET reschedule_request_status = 'pending', reschedule_requested_date = $1,
            reschedule_requested_time = $2, reschedule_requested_end_time = $3,
            reschedule_reason = $4, reschedule_description = $5,
            reschedule_requested_by = $6, reschedule_requested_at = NOW(),
            reschedule_reviewed_by = NULL, reschedule_reviewed_at = NULL
        WHERE appointment_id = $7
      `, [appointmentDate, appointmentTime, appointmentEndTime, reason, description, req.session.userId, appointmentId]);
      return res.json({ message: 'Reschedule request sent to the admin.' });
    }

    await db.query(`
      UPDATE appointments
      SET appointment_date = $1, appointment_time = $2, appointment_end_time = $3
      WHERE appointment_id = $4
    `, [appointmentDate, appointmentTime, appointmentEndTime, appointmentId]);
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
    const availableAestheticians = await findAvailableAestheticians(db, booking);
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

    const configuredMethods = (process.env.PAYMONGO_PAYMENT_METHODS || 'card,gcash,qrph')
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

  try {
    const paymentResult = await db.query(`
      SELECT reference_number, user_id, service_id, appointment_date::text AS appointment_date,
              appointment_time::text AS appointment_time, appointment_end_time::text AS appointment_end_time,
              service_name, service_price, amount_cents, currency, status,
             checkout_session_id, appointment_id, livemode
      FROM paymongo_checkout_sessions
      WHERE reference_number = $1 AND user_id = $2
    `, [referenceNumber, req.session.userId]);
    if (paymentResult.rows.length === 0) return res.status(404).json({ message: 'Checkout session not found.' });
    const payment = paymentResult.rows[0];

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
        SELECT status, appointment_id
        FROM paymongo_checkout_sessions
        WHERE reference_number = $1 AND user_id = $2
        FOR UPDATE
      `, [referenceNumber, req.session.userId]);
      if (lockedPayment.rows.length === 0) throw new Error('Checkout session not found.');
      if (lockedPayment.rows[0].status === 'consumed' && lockedPayment.rows[0].appointment_id) {
        return { appointment_id: lockedPayment.rows[0].appointment_id };
      }
      if (lockedPayment.rows[0].status !== 'paid') {
        const error = new Error('Payment is still being verified.');
        error.code = 'PAYMENT_NOT_PAID';
        throw error;
      }

      await client.query(`UPDATE appointments SET appointment_status = 'cancelled' WHERE appointment_status = 'pending' AND payment_status = 'unpaid' AND created_at < NOW() - INTERVAL '30 minutes'`);
      const candidates = await findAvailableAestheticians(client, {
        appointmentDate: payment.appointment_date,
        appointmentTime: payment.appointment_time,
        appointmentEndTime: payment.appointment_end_time,
      });

      for (const candidate of candidates.rows) {
        await client.query('SAVEPOINT appointment_candidate');
        try {
          const result = await client.query(`
            INSERT INTO appointments (user_id, service_id, booked_service_price, booked_reservation_fee, appointment_date, appointment_time, appointment_end_time, aesthetician_id, appointment_status, payment_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'paid')
            RETURNING appointment_id, appointment_status, payment_status
          `, [payment.user_id, payment.service_id, payment.service_price,
            Number(payment.amount_cents) / 100, payment.appointment_date,
            payment.appointment_time, payment.appointment_end_time, candidate.user_id]);
          await client.query(`
            UPDATE paymongo_checkout_sessions
            SET status = 'consumed', appointment_id = $1, updated_at = NOW()
            WHERE reference_number = $2
          `, [result.rows[0].appointment_id, referenceNumber]);
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

      const error = new Error('That time slot was just taken. Your payment was received, but no appointment was created. Contact support to arrange a refund.');
      error.code = 'SLOT_UNAVAILABLE';
      throw error;
    });

    return res.status(201).json({
      message: 'Appointment created successfully.',
      appointment: {
        appointment_id: appointment.appointment_id,
        service_name: payment.service_name,
        appointment_date: payment.appointment_date,
        appointment_time: payment.appointment_time,
        appointment_status: appointment.appointment_status || 'pending',
        payment_status: appointment.payment_status || 'paid'
      }
    });
  } catch (error) {
    if (error.code === 'PAYMENT_NOT_PAID') return res.status(409).json({ pending: true, message: error.message });
    if (error.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ message: error.message });
    if (error.code === '23P01' || error.code === '23505') return res.status(409).json({ message: 'That time slot was just taken. Contact support to arrange a refund.' });
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

  try {
    const result = await db.query(`
      UPDATE paymongo_checkout_sessions
      SET status = 'paid', updated_at = NOW()
      WHERE reference_number = $1 AND checkout_session_id = $2 AND livemode = $3
        AND amount_cents = $4 AND currency = 'PHP' AND status = 'pending'
      RETURNING reference_number
    `, [referenceNumber, session.id, config.isLive, sessionAmount]);
    if (result.rows.length === 0) {
      const existing = await db.query(`
        SELECT status FROM paymongo_checkout_sessions
        WHERE reference_number = $1 AND checkout_session_id = $2 AND livemode = $3
      `, [referenceNumber, session.id, config.isLive]);
      if (existing.rows.length === 0) console.warn('Ignoring unmatched PayMongo checkout event.');
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
