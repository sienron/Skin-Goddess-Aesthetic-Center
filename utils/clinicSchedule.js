const { from24h, overlapsLunchBreak, BOOKING_INTERVAL_MINUTES } = require('./slots');

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, weekday) => ({ weekday, is_open: true, opening_time: '09:00', closing_time: '18:00' }));
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function weekday(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function minutes(time) { const [h, m] = time.slice(0, 5).split(':').map(Number); return h * 60 + m; }
function normalizeHours(days) {
  if (!Array.isArray(days) || days.length !== 7) throw Object.assign(new Error('Provide all seven operating days.'), { statusCode: 400 });
  const seen = new Set();
  return days.map((day) => {
    if (!day || !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || seen.has(day.weekday)
      || typeof day.is_open !== 'boolean' || typeof day.opening_time !== 'string' || typeof day.closing_time !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.opening_time)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.closing_time) || day.opening_time >= day.closing_time) {
      throw Object.assign(new Error('Each day needs a valid opening time before its closing time.'), { statusCode: 400 });
    }
    seen.add(day.weekday);
    return { weekday: day.weekday, is_open: day.is_open, opening_time: day.opening_time, closing_time: day.closing_time };
  }).sort((a, b) => a.weekday - b.weekday);
}
async function loadSchedule(client) {
  const hours = await client.query('SELECT weekday, is_open, opening_time::text, closing_time::text FROM clinic_operating_hours ORDER BY weekday');
  const closures = await client.query("SELECT closure_id, closure_date::text, reason FROM clinic_closures WHERE reopened_at IS NULL");
  return { days: hours.rows, closures: closures.rows };
}
function dayHours(schedule, date) { return schedule.days.find((day) => day.weekday === weekday(date)); }
function fitsSchedule(schedule, date, start, end) {
  const day = dayHours(schedule, date);
  return !!day?.is_open && !schedule.closures.some((closure) => closure.closure_date === date)
    && !!end && start.slice(0, 5) >= day.opening_time.slice(0, 5) && end.slice(0, 5) <= day.closing_time.slice(0, 5)
    && !overlapsLunchBreak(start.slice(0, 5), end.slice(0, 5));
}
function slotsForDate(schedule, date) {
  const day = dayHours(schedule, date);
  if (!day?.is_open || schedule.closures.some((closure) => closure.closure_date === date)) return [];
  const slots = [];
  for (let t = Math.ceil(minutes(day.opening_time) / BOOKING_INTERVAL_MINUTES) * BOOKING_INTERVAL_MINUTES; t < minutes(day.closing_time); t += BOOKING_INTERVAL_MINUTES) {
    const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    if (time < '12:00' || time >= '13:00') slots.push(from24h(time));
  }
  return slots;
}
async function assertClinicAvailable(client, date, start, end) {
  if (!fitsSchedule(await loadSchedule(client), date, start, end) || minutes(start) % BOOKING_INTERVAL_MINUTES !== 0) {
    throw Object.assign(new Error('The clinic is closed or this appointment falls outside its operating hours. Choose another slot.'), { statusCode: 409 });
  }
}
module.exports = { DEFAULT_HOURS, DAY_NAMES, validDate, normalizeHours, loadSchedule, fitsSchedule, slotsForDate, assertClinicAvailable };
