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
  const monthView = document.getElementById('calMonthView');
  const weekView = document.getElementById('calWeekView');
  const weekHeader = document.getElementById('calWeekHeader');
  const weekTimeColumn = document.getElementById('calWeekTimeColumn');
  const weekDaysGrid = document.getElementById('calWeekDaysGrid');

  if (!grid || !weekdaysEl || !titleEl || !prevBtn || !nextBtn || !weekBtn || !monthBtn ||
      !message || !modal || !modalBody || !modalClose || !monthView || !weekView ||
      !weekHeader || !weekTimeColumn || !weekDaysGrid) return;

  const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEK_START_HOUR = 9;
  const WEEK_END_HOUR = 18; // salon closes at 6PM
  const HOUR_HEIGHT = 100; // px, matches .hour-label height / .week-day-col-bg grid lines

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

  // 9 -> "9 AM", 14 -> "2 PM" (used for the week-view hour axis)
  function formatHourLabel(h) {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12} ${suffix}`;
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

  function buildRatingStars(onSelect) {
    const starsRow = document.createElement('div');
    starsRow.className = 'appt-rating-stars';
    let selected = 0;
    const starButtons = [];
    for (let i = 1; i <= 5; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'appt-rating-star';
      btn.textContent = '★';
      btn.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
      btn.addEventListener('click', () => {
        selected = i;
        starButtons.forEach((b, idx) => b.classList.toggle('is-filled', idx < selected));
        onSelect(selected);
      });
      starButtons.push(btn);
      starsRow.appendChild(btn);
    }
    return starsRow;
  }

  function buildReadonlyStars(value) {
    const starsRow = document.createElement('div');
    starsRow.className = 'appt-rating-stars appt-rating-stars--readonly';
    for (let i = 1; i <= 5; i += 1) {
      const star = document.createElement('span');
      star.className = 'appt-rating-star';
      if (i <= value) star.classList.add('is-filled');
      star.textContent = '★';
      starsRow.appendChild(star);
    }
    return starsRow;
  }

  function buildRatingSection(appointment) {
    const wrap = document.createElement('div');
    wrap.className = 'appt-rating-section';

    if (appointment.hasRating) {
      const heading = document.createElement('p');
      heading.className = 'appt-rating-heading';
      heading.textContent = `You rated this visit ${appointment.myRating}★`;
      wrap.append(heading, buildReadonlyStars(appointment.myRating));
      if (appointment.myRatingComment) {
        const comment = document.createElement('p');
        comment.className = 'appt-rating-readonly-comment';
        comment.textContent = appointment.myRatingComment;
        wrap.appendChild(comment);
      }
      return wrap;
    }

    const heading = document.createElement('p');
    heading.className = 'appt-rating-heading';
    heading.textContent = 'Rate your visit';
    wrap.appendChild(heading);

    let selectedRating = 0;
    wrap.appendChild(buildRatingStars((value) => { selectedRating = value; }));

    const commentBox = document.createElement('textarea');
    commentBox.className = 'appt-rating-comment';
    commentBox.maxLength = 1000;
    commentBox.placeholder = 'Optional comment (max 1000 characters)';
    wrap.appendChild(commentBox);

    const errorEl = document.createElement('p');
    errorEl.className = 'appt-rating-error';
    wrap.appendChild(errorEl);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'appt-rating-submit';
    submitBtn.textContent = 'Submit rating';
    submitBtn.addEventListener('click', async () => {
      if (!selectedRating) { errorEl.textContent = 'Choose a star rating.'; return; }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      try {
        const response = await fetch(`/api/appointments/${appointment.appointment_id}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: selectedRating, comment: commentBox.value.trim() || undefined }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Could not submit your rating.');
        appointment.hasRating = true;
        appointment.myRating = selectedRating;
        appointment.myRatingComment = commentBox.value.trim() || null;
        wrap.replaceWith(buildRatingSection(appointment));
      } catch (error) {
        errorEl.textContent = error.message;
        submitBtn.disabled = false;
      }
    });
    wrap.appendChild(submitBtn);

    return wrap;
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

    if (appointment.appointment_status === 'completed') {
      modalBody.appendChild(buildRatingSection(appointment));
    }

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

  function buildWeekChip(appointment, todayKey) {
    const dateKey = String(appointment.appointment_date).slice(0, 10);
    const [startH, startM] = String(appointment.appointment_time).split(':').map(Number);
    const [endH, endM] = String(appointment.appointment_end_time).split(':').map(Number);
    const startMinutes = Math.max((startH - WEEK_START_HOUR) * 60 + startM, 0);
    const endMinutes = Math.min((endH - WEEK_START_HOUR) * 60 + endM, (WEEK_END_HOUR - WEEK_START_HOUR) * 60);
    const duration = Math.max(endMinutes - startMinutes, 30);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'appt-chip-week';
    if (appointment.appointment_status === 'cancelled') chip.classList.add('is-cancelled');
    else if (dateKey < todayKey) chip.classList.add('is-past');
    chip.style.top = `${(startMinutes / 60) * HOUR_HEIGHT}px`;
    chip.style.height = `${(duration / 60) * HOUR_HEIGHT}px`;

    const name = document.createElement('span');
    name.className = 'cal-chip-name';
    name.textContent = appointment.service_name;

    const time = document.createElement('span');
    time.className = 'cal-chip-time';
    time.textContent = `${formatTime(appointment.appointment_time)} – ${formatTime(appointment.appointment_end_time)}`;

    chip.append(name, document.createElement('br'), time);
    chip.addEventListener('click', () => openModal(appointment));
    return chip;
  }

  function renderMonthGrid(todayKey) {
    weekdaysEl.replaceChildren(...DAY_NAMES.map((name) => {
      const cell = document.createElement('div');
      cell.textContent = name;
      return cell;
    }));

    grid.replaceChildren();

    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const offset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const count = Math.ceil((offset + daysInMonth) / 7) * 7;
    const start = new Date(year, month, 1 - offset);
    titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;

    for (let i = 0; i < count; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dayKey = keyOf(day);

      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (day.getMonth() !== month) cell.classList.add('other-month');

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

  function renderWeekGrid(todayKey) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const start = new Date(year, month, cursor.getDate() - cursor.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const startLabel = `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
    const endLabel = start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
    titleEl.textContent = `${startLabel} – ${endLabel}, ${end.getFullYear()}`;

    weekTimeColumn.replaceChildren();
    for (let h = WEEK_START_HOUR; h <= WEEK_END_HOUR; h += 1) {
      const label = document.createElement('div');
      label.className = 'hour-label';
      label.textContent = formatHourLabel(h);
      weekTimeColumn.appendChild(label);
    }

    const headerCells = [document.createElement('div')];
    headerCells[0].className = 'week-time-label';

    weekDaysGrid.replaceChildren();
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dayKey = keyOf(day);

      const headerCell = document.createElement('div');
      headerCell.className = 'week-day-col';
      headerCell.append(`${DAY_NAMES[day.getDay()]} `);
      const dateNum = document.createElement('span');
      dateNum.className = 'week-date-num';
      if (dayKey === todayKey) dateNum.classList.add('is-today');
      dateNum.textContent = String(day.getDate());
      headerCell.appendChild(dateNum);
      headerCells.push(headerCell);

      const col = document.createElement('div');
      col.className = 'week-day-col-bg';
      col.style.height = `${(WEEK_END_HOUR - WEEK_START_HOUR + 1) * HOUR_HEIGHT}px`;

      (appointmentsByDate[dayKey] || []).forEach((appointment) => {
        col.appendChild(buildWeekChip(appointment, todayKey));
      });

      weekDaysGrid.appendChild(col);
    }

    weekHeader.replaceChildren(...headerCells);
  }

  function render() {
    const todayKey = manilaTodayKey();

    weekBtn.classList.toggle('active', view === 'week');
    monthBtn.classList.toggle('active', view === 'month');
    weekBtn.setAttribute('aria-pressed', String(view === 'week'));
    monthBtn.setAttribute('aria-pressed', String(view === 'month'));
    monthView.style.display = view === 'month' ? '' : 'none';
    weekView.style.display = view === 'week' ? 'block' : 'none';

    if (view === 'month') renderMonthGrid(todayKey);
    else renderWeekGrid(todayKey);
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