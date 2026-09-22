const express = require('express');
const router = express.Router();
const db = require('../db');
const { VALID_SLOTS, CLOSING_TIME, CLOSED_WEEKDAYS, MAX_ADVANCE_DAYS, MIN_BOOKING_LEAD_MINUTES, to24h, addMinutes, manilaNow, isSlotInPast, isSlotTooSoon } = require('../utils/slots');

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

// Must stay before any future /:id GET route so "mine" is never treated as an ID.
router.get('/mine', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  try {
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
               COALESCE(CONCAT(c.first_name, ' ', c.last_name), 'Client') AS client,
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
      SELECT appointment_id, user_id, appointment_date::text AS appointment_date,
             appointment_time::text AS appointment_time, appointment_status
      FROM appointments
      WHERE appointment_id = $1
    `, [appointmentId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Appointment not found.' });

    const appointment = result.rows[0];
    if (appointment.user_id !== req.session.userId) return res.status(403).json({ message: 'You cannot cancel another client’s appointment.' });
    if (!['pending', 'confirmed'].includes(appointment.appointment_status)) return res.status(400).json({ message: 'Only pending or confirmed appointments can be cancelled.' });
    if (minutesUntil(appointment.appointment_date, appointment.appointment_time, manilaNow()) < 24 * 60) return res.status(400).json({ message: 'Appointments can only be cancelled at least 24 hours in advance.' });

    await db.query(`UPDATE appointments SET appointment_status = 'cancelled' WHERE appointment_id = $1`, [appointmentId]);
    return res.json({ message: 'Appointment cancelled successfully.' });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return res.status(500).json({ message: 'Could not cancel appointment.' });
  }
});

router.post('/', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const serviceId = validServiceId(body.serviceId);
  const appointmentDate = normalizeDate(body.date);

  try {
    const userResult = await db.query('SELECT user_id, email_verified, role FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) return res.status(401).json({ message: 'Your session is no longer valid. Please log in again.' });
    if (!userResult.rows[0].email_verified || userResult.rows[0].role !== 'client') return res.status(403).json({ message: 'Only verified client accounts can book appointments.' });

    if (!serviceId) return res.status(400).json({ message: 'Choose a valid service.' });
    const serviceResult = await db.query(`SELECT service_id, service_name, duration_minutes, service_price, reservation_fee FROM services WHERE service_id = $1 AND is_active = TRUE`, [serviceId]);
    if (serviceResult.rows.length === 0) return res.status(404).json({ message: 'Service not found.' });
    const service = serviceResult.rows[0];

    if (!appointmentDate) return res.status(400).json({ message: 'Choose a valid appointment date.' });
    const now = manilaNow();
    if (appointmentDate < now.dateStr) return res.status(400).json({ message: 'Appointments cannot be booked in the past.' });
    if (appointmentDate > addCalendarDays(now.dateStr, MAX_ADVANCE_DAYS)) return res.status(400).json({ message: `Appointments can only be booked up to ${MAX_ADVANCE_DAYS} days in advance.` });
    if (CLOSED_WEEKDAYS.includes(weekday(appointmentDate))) return res.status(400).json({ message: 'The center is closed on the selected date.' });

    if (typeof body.time !== 'string' || !VALID_SLOTS.includes(body.time)) return res.status(400).json({ message: 'Choose an available appointment time.' });
    const appointmentTime = to24h(body.time);
    if (!appointmentTime || isSlotInPast(appointmentDate, appointmentTime)) return res.status(400).json({ message: 'Appointments cannot be booked in the past.' });
    if (isSlotTooSoon(appointmentDate, appointmentTime)) return res.status(400).json({ message: `Please choose a time at least ${MIN_BOOKING_LEAD_MINUTES} minutes from now.` });

    const appointmentEndTime = addMinutes(appointmentTime, Number(service.duration_minutes));
    if (!appointmentEndTime || appointmentEndTime > CLOSING_TIME) return res.status(400).json({ message: 'This service does not fit within the center’s operating hours at the selected time.' });

    await db.query(`UPDATE appointments SET appointment_status = 'cancelled' WHERE appointment_status = 'pending' AND payment_status = 'unpaid' AND created_at < NOW() - INTERVAL '30 minutes'`);

    const activeHoldResult = await db.query(`SELECT COUNT(*)::integer AS count FROM appointments WHERE user_id = $1 AND appointment_status = 'pending' AND payment_status = 'unpaid'`, [userResult.rows[0].user_id]);
    if (activeHoldResult.rows[0].count >= 3) return res.status(429).json({ message: 'You already have 3 unpaid appointment holds. Complete or cancel one before booking another.' });

    const candidates = await db.query(`
      SELECT u.user_id FROM users u
      WHERE u.role = 'aesthetician' AND u.email_verified = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.aesthetician_id = u.user_id
            AND a.appointment_status IN ('pending', 'confirmed', 'completed')
            AND tsrange(a.appointment_date + a.appointment_time, a.appointment_date + a.appointment_end_time) && tsrange($1::date + $2::time, $1::date + $3::time)
        )
      ORDER BY u.user_id
    `, [appointmentDate, appointmentTime, appointmentEndTime]);

    for (const candidate of candidates.rows) {
      try {
        const appointmentResult = await db.query(`
          INSERT INTO appointments (user_id, service_id, booked_service_price, booked_reservation_fee, appointment_date, appointment_time, appointment_end_time, aesthetician_id, appointment_status, payment_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'unpaid')
          RETURNING appointment_id, appointment_status, payment_status
        `, [userResult.rows[0].user_id, service.service_id, service.service_price, service.reservation_fee, appointmentDate, appointmentTime, appointmentEndTime, candidate.user_id]);

        return res.status(201).json({
          message: 'Appointment created successfully.',
          appointment: {
            appointment_id: appointmentResult.rows[0].appointment_id,
            service_name: service.service_name,
            appointment_date: appointmentDate,
            appointment_time: appointmentTime,
            appointment_status: appointmentResult.rows[0].appointment_status,
            payment_status: appointmentResult.rows[0].payment_status,
          },
        });
      } catch (error) {
        if (error.code === '23P01' || error.code === '23505') continue;
        throw error;
      }
    }

    return res.status(409).json({ message: 'That time slot was just taken. Please choose another.' });
  } catch (error) {
    console.error('Error creating appointment:', error);
    return res.status(500).json({ message: 'Could not create appointment.' });
  }
});

module.exports = router;
