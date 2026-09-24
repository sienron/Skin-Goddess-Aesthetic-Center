// Shared appointment-slot rules. Update this one file if operating hours change.
const VALID_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'];
const CLOSING_TIME = '18:00';
const CLOSED_WEEKDAYS = [];
const MAX_ADVANCE_DAYS = 60;
const MIN_BOOKING_LEAD_MINUTES = 30;

function to24h(slot) {
  if (typeof slot !== 'string') return null;
  const match = slot.trim().match(/^(1[0-2]|[1-9]):([0-5]\d)\s([AP]M)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();
  if (period === 'AM') hour = hour === 12 ? 0 : hour;
  if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function from24h(time) {
  if (typeof time !== 'string') return null;
  const match = time.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (!match) return null;

  const hour24 = Number(match[1]);
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${match[2]} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

function addMinutes(time24, minutes) {
  if (typeof time24 !== 'string' || !Number.isInteger(minutes)) return null;
  const match = time24.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (totalMinutes < 0 || totalMinutes >= 24 * 60) return null;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function manilaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { dateStr: `${values.year}-${values.month}-${values.day}`, timeStr: `${values.hour}:${values.minute}` };
}

function isSlotInPast(dateStr, timeStr24) {
  const now = manilaNow();
  return dateStr < now.dateStr || (dateStr === now.dateStr && timeStr24 <= now.timeStr);
}

// Same-day bookings need at least the configured lead time before they begin.
function isSlotTooSoon(dateStr, timeStr24) {
  const now = manilaNow();
  if (dateStr < now.dateStr) return true;
  if (dateStr > now.dateStr) return false;

  const [slotHour, slotMinute] = timeStr24.split(':').map(Number);
  const [nowHour, nowMinute] = now.timeStr.split(':').map(Number);
  return (slotHour * 60 + slotMinute) - (nowHour * 60 + nowMinute) < MIN_BOOKING_LEAD_MINUTES;
}

module.exports = {
  VALID_SLOTS,
  CLOSING_TIME,
  CLOSED_WEEKDAYS,
  MAX_ADVANCE_DAYS,
  MIN_BOOKING_LEAD_MINUTES,
  to24h,
  from24h,
  addMinutes,
  manilaNow,
  isSlotInPast,
  isSlotTooSoon,
};
