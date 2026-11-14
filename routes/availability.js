const express = require('express');
const router = express.Router();
const db = require('../db');
const { loadSchedule, slotsForDate, fitsSchedule } = require('../utils/clinicSchedule');
const { CLOSED_WEEKDAYS, MAX_ADVANCE_DAYS, DEFAULT_BUFFER_MINUTES, to24h, addMinutes, manilaNow, isSlotInPast, isSlotTooSoon } = require('../utils/slots');

function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function daysInMonth(year, month) { return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]; }
function formatDate(year, month, day) { return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function weekday(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (adjustedYear + Math.floor(adjustedYear / 4) - Math.floor(adjustedYear / 100) + Math.floor(adjustedYear / 400) + offsets[month - 1] + day) % 7;
}
function addCalendarDays(dateStr, count) {
  let [year, month, day] = dateStr.split('-').map(Number);
  while (count > 0) {
    day += 1;
    if (day > daysInMonth(year, month)) { day = 1; month += 1; if (month > 12) { month = 1; year += 1; } }
    count -= 1;
  }
  return formatDate(year, month, day);
}
function validServiceId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
  return null;
}
function minutes(time) { const [hour, minute] = time.slice(0, 5).split(':').map(Number); return hour * 60 + minute; }

router.get('/', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'You must be logged in.' });

  const monthMatch = typeof req.query.month === 'string' && req.query.month.match(/^(\d{4})-(\d{2})$/);
  const serviceId = validServiceId(req.query.serviceId);
  const appointmentIdValue = req.query.appointmentId;
  const appointmentId = typeof appointmentIdValue === 'string' && /^\d+$/.test(appointmentIdValue)
    ? Number(appointmentIdValue)
    : null;
  if (!monthMatch) return res.status(400).json({ message: 'month must use YYYY-MM.' });
  if (!serviceId) return res.status(400).json({ message: 'Choose a valid service.' });
  if (appointmentIdValue !== undefined && (!Number.isSafeInteger(appointmentId) || appointmentId <= 0)) {
    return res.status(400).json({ message: 'Choose a valid appointment.' });
  }

  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  if (year < 1 || month < 1 || month > 12) return res.status(400).json({ message: 'month must use YYYY-MM.' });

  try {
    const serviceResult = await db.query('SELECT duration_minutes, buffer_minutes FROM services WHERE service_id = $1 AND is_active = TRUE', [serviceId]);
    if (serviceResult.rows.length === 0) return res.status(404).json({ message: 'Service not found.' });
    const duration = Number(serviceResult.rows[0].duration_minutes)
      + Number(serviceResult.rows[0].buffer_minutes ?? DEFAULT_BUFFER_MINUTES);
    let targetAestheticianId = null;
    if (appointmentId !== null) {
      const appointmentResult = await db.query(`
        SELECT appointment_id, aesthetician_id, service_id, appointment_status
        FROM appointments
        WHERE appointment_id = $1
      `, [appointmentId]);
      const appointment = appointmentResult.rows[0];
      if (!appointment) return res.status(404).json({ message: 'Appointment not found.' });

      const userResult = await db.query(
        'SELECT role FROM users WHERE user_id = $1 AND status = $2',
        [req.session.userId, 'active']
      );
      const role = userResult.rows[0]?.role;
      const isAdmin = role === 'admin';
      const isAssignedAesthetician = role === 'aesthetician'
        && Number(appointment.aesthetician_id) === Number(req.session.userId);
      if (!isAdmin && !isAssignedAesthetician) {
        return res.status(403).json({ message: 'You cannot view availability for this appointment.' });
      }
      if (appointment.appointment_status !== 'confirmed') {
        return res.status(400).json({ message: 'Only confirmed appointments can be rescheduled.' });
      }
      if (Number(appointment.service_id) !== Number(serviceId)) {
        return res.status(400).json({ message: 'Choose the service assigned to this appointment.' });
      }
      if (!appointment.aesthetician_id) {
        return res.status(409).json({ message: 'This appointment has no assigned aesthetician.' });
      }
      targetAestheticianId = appointment.aesthetician_id;
    }

    const aestheticians = await db.query("SELECT user_id FROM users WHERE role = 'aesthetician' AND status = 'active' AND email_verified = TRUE ORDER BY user_id");
    if (aestheticians.rows.length === 0) return res.json({});
    const availableAestheticians = targetAestheticianId === null
      ? aestheticians.rows
      : aestheticians.rows.filter(({ user_id }) => String(user_id) === String(targetAestheticianId));
    if (availableAestheticians.length === 0) return res.json({});

    const firstDate = formatDate(year, month, 1);
    const lastDate = formatDate(year, month, daysInMonth(year, month));
    const appointments = await db.query(`
      SELECT aesthetician_id, appointment_date::text AS appointment_date,
             appointment_time::text AS appointment_time,
             GREATEST(appointment_end_time, COALESCE(adjusted_expected_end_time, appointment_end_time))::text AS appointment_end_time
      FROM appointments
      WHERE appointment_status IN ('confirmed', 'in_progress', 'completed')
        AND appointment_date BETWEEN $1::date AND $2::date
    `, [firstDate, lastDate]);
    const now = manilaNow();
    const clinicSchedule = await loadSchedule(db);
    const latestDate = addCalendarDays(now.dateStr, MAX_ADVANCE_DAYS);
    const availability = {};

    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const dateStr = formatDate(year, month, day);
      if (dateStr < now.dateStr || dateStr > latestDate || CLOSED_WEEKDAYS.includes(weekday(dateStr))) continue;

      const slots = slotsForDate(clinicSchedule, dateStr).filter((slot) => {
        const start = to24h(slot);
        const end = addMinutes(start, duration);
        if (!end || !fitsSchedule(clinicSchedule, dateStr, start, end)
          || isSlotInPast(dateStr, start) || isSlotTooSoon(dateStr, start)) return false;
        return availableAestheticians.some(({ user_id }) => !appointments.rows.some((appointment) => (
          appointment.aesthetician_id === user_id
          && appointment.appointment_date === dateStr
          && minutes(appointment.appointment_time) < minutes(end)
          && minutes(appointment.appointment_end_time) > minutes(start)
        )));
      });

      if (slots.length > 0) {
        const dateKey = `${year}-${month - 1}-${day}`;
        availability[dateKey] = slots;
      }
    }

    return res.json(availability);
  } catch (error) {
    console.error('Error fetching appointment availability:', error);
    return res.status(500).json({ message: 'Could not load availability.' });
  }
});

module.exports = router;
