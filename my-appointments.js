/* Client appointment calendar (Week / Month).
   Data comes from /api/appointments/mine; the server remains the authorization authority. */
(function () {
  const grid = document.getElementById('calGrid');
  const weekdaysEl = document.getElementById('calWeekdays');
  const titleEl = document.getElementById('calTitle');
  const prevBtn = document.getElementById('calPrev');
  const nextBtn = document.getElementById('calNext');
  const weekBtn = document.getElementById('calWeekBtn');
  const monthBtn = document.getElementById('calMonthBtn');
  const message = document.getElementById('appointmentsMessage');
  const modal = document.getElementById('apptModal');
  const modalBody = document.getElementById('apptModalBody');
  const modalClose = document.getElementById('apptModalClose');

  if (!grid || !weekdaysEl || !titleEl || !prevBtn || !nextBtn || !weekBtn || !monthBtn ||
      !message || !modal || !modalBody || !modalClose) return;

  const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  let view = 'month';
  let appointmentsByDate = {};
  let lastFocused = null;

  // ---- Date helpers (all plain YYYY-MM-DD strings, no timezone surprises) ----
  function pad(n) { return String(n).padStart(2, '0'); }

  function keyOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function manilaTodayKey() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  // "10:00:00" -> "10AM", "14:30:00" -> "2:30PM"
  function formatTime(timeString) {
    const [h, m] = String(timeString).split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour12}:${pad(m)}${suffix}` : `${hour12}${suffix}`;
  }

  let cursor = parseKey(manilaTodayKey());

  // ---- Modal ----
  function detailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'appt-detail-row';
    const l = document.createElement('span');
    l.className = 'appt-detail-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'appt-detail-value';
    v.textContent = value;
    row.append(l, v);
    return row;
  }

  function openModal(appointment) {
    lastFocused = document.activeElement;
    const dateKey = String(appointment.appointment_date).slice(0, 10);
    const prettyDate = parseKey(dateKey).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const statusLabel = String(appointment.appointment_status || '').replace(/_/g, ' ').toUpperCase();
    const paymentLabel = String(appointment.payment_status || '').replace(/_/g, ' ').toUpperCase();

    modalBody.replaceChildren(
      detailRow('Service', appointment.service_name),
      detailRow('Date', prettyDate),
      detailRow('Time', `${formatTime(appointment.appointment_time)} – ${formatTime(appointment.appointment_end_time)}`),
      detailRow('Status', statusLabel),
      detailRow('Payment', paymentLabel),
      detailRow('Reservation fee', `₱${Number(appointment.booked_reservation_fee).toLocaleString('en-US')}`)
    );

    modal.hidden = false;
    modalClose.focus();
  }

  function closeModal() {
    modal.hidden = true;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  // ---- Calendar rendering ----
  function buildChip(appointment, todayKey) {
    const dateKey = String(appointment.appointment_date).slice(0, 10);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cal-chip';
    if (appointment.appointment_status === 'cancelled') chip.classList.add('is-cancelled');
    else if (dateKey < todayKey) chip.classList.add('is-past');

    const name = document.createElement('span');
    name.className = 'cal-chip-name';
    name.textContent = appointment.service_name;

    const time = document.createElement('span');
    time.className = 'cal-chip-time';
    time.textContent = formatTime(appointment.appointment_time);

    chip.append(name, time);
    chip.addEventListener('click', () => openModal(appointment));
    return chip;
  }

  function render() {
    const todayKey = manilaTodayKey();

    weekdaysEl.replaceChildren(...DAY_NAMES.map((name) => {
      const cell = document.createElement('div');
      cell.textContent = name;
      return cell;
    }));

    grid.replaceChildren();
    grid.classList.toggle('is-week', view === 'week');
    weekBtn.classList.toggle('active', view === 'week');
    monthBtn.classList.toggle('active', view === 'month');
    weekBtn.setAttribute('aria-pressed', String(view === 'week'));
    monthBtn.setAttribute('aria-pressed', String(view === 'month'));

    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    let start;
    let count;

    if (view === 'month') {
      const offset = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      count = Math.ceil((offset + daysInMonth) / 7) * 7;
      start = new Date(year, month, 1 - offset);
      titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;
    } else {
      count = 7;
      start = new Date(year, month, cursor.getDate() - cursor.getDay());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const startLabel = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
      const endLabel = start.getMonth() === end.getMonth()
        ? `${end.getDate()}`
        : `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
      titleEl.textContent = `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
    }

    for (let i = 0; i < count; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dayKey = keyOf(day);

      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (view === 'month' && day.getMonth() !== month) cell.classList.add('other-month');

      const num = document.createElement('span');
      num.className = 'cal-daynum';
      if (dayKey === todayKey) num.classList.add('is-today');
      num.textContent = String(day.getDate());
      cell.appendChild(num);

      (appointmentsByDate[dayKey] || []).forEach((appointment) => {
        cell.appendChild(buildChip(appointment, todayKey));
      });

      grid.appendChild(cell);
    }
  }

  // ---- Navigation ----
  prevBtn.addEventListener('click', () => {
    cursor = view === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
    render();
  });

  nextBtn.addEventListener('click', () => {
    cursor = view === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    render();
  });

  weekBtn.addEventListener('click', () => { view = 'week'; render(); });
  monthBtn.addEventListener('click', () => { view = 'month'; render(); });

  // ---- Data ----
  async function loadAppointments() {
    message.textContent = '';
    try {
      const response = await fetch('/api/appointments/mine');
      if (!response.ok) throw new Error('Could not load your appointments.');
      const appointments = await response.json();

      appointmentsByDate = {};
      appointments.forEach((appointment) => {
        const key = String(appointment.appointment_date).slice(0, 10);
        (appointmentsByDate[key] = appointmentsByDate[key] || []).push(appointment);
      });
      Object.values(appointmentsByDate).forEach((list) => {
        list.sort((a, b) => String(a.appointment_time).localeCompare(String(b.appointment_time)));
      });

      if (appointments.length === 0) {
        message.textContent = 'You have no appointments yet. Book one and it will show up here.';
      }
    } catch (error) {
      message.textContent = error.message;
    }
    render();
  }

  render(); // show the empty calendar right away
  loadAppointments();
})();