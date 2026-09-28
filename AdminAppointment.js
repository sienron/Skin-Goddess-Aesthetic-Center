// AdminAppointment.html page-specific JS
// Renders the appointments table with status tabs, search, and pagination.
// The mobile sidebar drawer is handled by admin-dashboard.js.
// Appointment data is loaded from the admin API and refreshed periodically.
// Filter / Export / New Appointment / View / Edit / Rebook remain separate actions.

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('aptTableBody');
  const tabsWrap = document.getElementById('aptTabs');
  const footerText = document.getElementById('aptFooterText');
  const pagination = document.getElementById('aptPagination');
  const searchInput = document.getElementById('aptSearchInput');
  const todayChip = document.getElementById('aptTodayChip');

  if (!tbody || !tabsWrap || !footerText || !pagination) return;

  const PAGE_SIZE = 7;

  const STATUS_LABELS = {
    'confirmed': 'CONFIRMED',
    'in-progress': 'IN PROGRESS',
    'completed': 'COMPLETED',
    'cancelled': 'CANCELLED',
    'no-show': 'NO SHOW'
  };

  let APPOINTMENTS = [];
  let isLoading = true;
  let loadError = '';
  let requestInProgress = false;

  function manilaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year + '-' + values.month + '-' + values.day;
  }

  function displayDate(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function displayTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 'Time unavailable';
    const hour = Number(match[1]);
    return (hour % 12 || 12) + ':' + match[2] + ' ' + (hour >= 12 ? 'PM' : 'AM');
  }

  function clientAge(dateOfBirth) {
    if (!dateOfBirth) return '';
    const [birthYear, birthMonth, birthDay] = dateOfBirth.slice(0, 10).split('-').map(Number);
    if (!birthYear || !birthMonth || !birthDay) return '';
    const [year, month, day] = manilaDateKey().split('-').map(Number);
    let age = year - birthYear;
    if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
    return age >= 0 ? String(age) : '';
  }

  function normalizeAppointment(record) {
    const id = String(record.appointment_id ?? record.id ?? '');
    const dateKey = String(record.date ?? record.appointment_date ?? '').slice(0, 10);
    const gender = String(record.gender || '').trim();
    const genderLabel = gender.toLowerCase() === 'female' ? 'F'
      : gender.toLowerCase() === 'male' ? 'M' : gender;
    const age = clientAge(record.date_of_birth || record.dob || '');
    const previousCount = Number(record.previous_appointment_count) || 0;
    const profileParts = [genderLabel, age].filter(Boolean);
    const profile = [profileParts.join(', '), previousCount ? 'Returning' : 'New Patient'].filter(Boolean).join(' · ');

    return {
      id,
      ref: 'APT-' + id.padStart(4, '0'),
      client: String(record.client || `${record.first_name || ''} ${record.last_name || ''}`.trim() || 'Client'),
      profile,
      service: String(record.service || record.service_name || 'Service unavailable'),
      duration: (Number(record.duration_minutes) || 0) + ' min',
      dateKey,
      date: displayDate(dateKey),
      time: displayTime(record.start || record.appointment_time),
      assignedTo: String(record.assigned_to || record.aesthetician || 'Unassigned'),
      status: String(record.status || record.appointment_status || '').toLowerCase().replace(/_/g, '-'),
      isToday: dateKey === manilaDateKey(),
      fee: Number(record.fee ?? record.booked_service_price) || 0,
      depositAmount: Number(record.deposit_amount ?? record.depositAmount ?? record.booked_reservation_fee) || 0,
      paymentStatus: String(record.payment_status || 'unpaid').toLowerCase(),
      contact: String(record.contact || record.contact_number || '—'),
      cancellationRequestStatus: record.cancellation_request_status || null,
      cancellationReason: record.cancellation_reason || '',
      cancellationDescription: record.cancellation_description || ''
    };
  }

  const state = { status: 'all', todayOnly: false, query: '', page: 1 };

  // ---------- helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function readApiResponse(response) {
    const bodyText = await response.text();
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch (error) {
      return { message: response.status === 401 || response.status === 403 ? 'Your admin session is no longer valid. Please sign in again.' : `Request failed (${response.status}).` };
    }
  }

  function getInitials(name) {
    return name.split(' ').slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
  }

  function stackCell(main, sub, mainClass) {
    const td = el('td');
    td.appendChild(el('span', mainClass || '', main));
    td.appendChild(el('span', 'apt-sub', sub));
    return td;
  }

  function getFiltered() {
    const query = state.query.trim().toLowerCase();
    return APPOINTMENTS.filter((a) => {
      if (state.status !== 'all' && a.status !== state.status) return false;
      if (state.todayOnly && !a.isToday) return false;
      if (!query) return true;
      return [a.ref, a.client, a.service, a.assignedTo].some((v) => v.toLowerCase().includes(query));
    });
  }

  // ---------- rendering ----------

  function buildRow(a) {
    const tr = el('tr', 'apt-row');
    if (a.status === 'in-progress') tr.classList.add('apt-row--live');
    if (a.status === 'cancelled') tr.classList.add('apt-row--muted');

    const refTd = el('td');
    const refBox = el('div', 'apt-ref');
    refBox.appendChild(el('strong', '', a.ref));
    refBox.appendChild(el('span', '', a.isToday ? 'Today' : a.date.split(',')[0]));
    refTd.appendChild(refBox);

    const clientTd = el('td');
    const clientBox = el('div', 'um-user-cell');
    const avatar = el('div', 'um-avatar', getInitials(a.client));
    if (a.status === 'cancelled') avatar.classList.add('um-avatar--muted');
    const clientInfo = el('div');
    clientInfo.appendChild(el('span', 'apt-name', a.client));
    clientInfo.appendChild(el('span', 'apt-sub', a.profile));
    clientBox.appendChild(avatar);
    clientBox.appendChild(clientInfo);
    clientTd.appendChild(clientBox);

    const serviceTd = stackCell(a.service, a.duration, 'apt-name');
    const dateTd = stackCell(a.date, a.time, 'apt-name');
    const assignedTd = el('td', '', a.assignedTo);

    const statusTd = el('td');
    const statusClass = a.status === 'no-show' ? 'cancelled' : a.status;
    statusTd.appendChild(el('span', 'apt-status apt-status--' + statusClass, STATUS_LABELS[a.status] || a.status.toUpperCase()));

    const actionTd = el('td');
    const actions = el('div', 'apt-actions');
    const viewBtn = el('button', 'apt-action apt-action--view', 'View');
    viewBtn.type = 'button';
    viewBtn.dataset.action = 'view';
    viewBtn.dataset.ref = a.ref;
    const isClosed = a.status === 'completed' || a.status === 'cancelled' || a.status === 'no-show';
    const secondBtn = el('button', 'apt-action', isClosed ? 'Rebook' : 'Edit');
    secondBtn.type = 'button';
    secondBtn.dataset.action = isClosed ? 'rebook' : 'edit';
    secondBtn.dataset.ref = a.ref;
    actions.appendChild(viewBtn);
    actions.appendChild(secondBtn);
    actionTd.appendChild(actions);

    [refTd, clientTd, serviceTd, dateTd, assignedTd, statusTd, actionTd].forEach((td) => tr.appendChild(td));
    return tr;
  }

  function renderTabs() {
    tabsWrap.querySelectorAll('.um-tab').forEach((tab) => {
      const key = tab.dataset.status;
      const count = key === 'all' ? APPOINTMENTS.length : APPOINTMENTS.filter((a) => a.status === key).length;
      tab.textContent = tab.dataset.label + ' (' + count + ')';
      tab.classList.toggle('um-tab--active', key === state.status);
    });
    if (todayChip) todayChip.hidden = !state.todayOnly;
  }

  function renderPagination(totalPages) {
    pagination.textContent = '';

    const makeBtn = (label, page, disabled, active) => {
      const btn = el('button', active ? 'active' : '', label);
      btn.type = 'button';
      btn.disabled = disabled;
      btn.addEventListener('click', () => {
        state.page = page;
        render();
      });
      return btn;
    };

    pagination.appendChild(makeBtn('‹', state.page - 1, state.page === 1, false));
    for (let p = 1; p <= totalPages; p++) {
      pagination.appendChild(makeBtn(String(p), p, false, p === state.page));
    }
    pagination.appendChild(makeBtn('›', state.page + 1, state.page === totalPages, false));
  }

  function render() {
    const filtered = getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);

    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    tbody.textContent = '';
    if (isLoading && APPOINTMENTS.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', 'Loading appointments…');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else if (loadError && APPOINTMENTS.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', loadError);
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else if (pageRows.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', 'No appointments match this filter.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      pageRows.forEach((a) => tbody.appendChild(buildRow(a)));
    }

    footerText.textContent = isLoading && APPOINTMENTS.length === 0
      ? 'Loading appointments…'
      : 'Showing ' + pageRows.length + ' of ' + filtered.length + ' appointments';
    renderTabs();
    renderPagination(totalPages);
    renderSummary();
    renderInsights();
  }

  function renderSummary() {
    const values = {
      aptTodayCount: APPOINTMENTS.filter((appointment) => appointment.isToday).length,
      aptConfirmedCount: APPOINTMENTS.filter((appointment) => appointment.status === 'confirmed').length,
      aptCancelledCount: APPOINTMENTS.filter((appointment) => appointment.status === 'cancelled').length
    };
    Object.entries(values).forEach(([id, value]) => {
      const target = document.getElementById(id);
      if (target) target.textContent = String(value);
    });
  }

  function renderInsights() {
    const timeline = document.getElementById('aptTimelineList');
    const timelineDate = document.getElementById('aptTimelineDate');
    const breakdown = document.getElementById('aptBreakdown');
    const totalCount = document.getElementById('aptTotalCount');
    const topServices = document.getElementById('aptTopServices');
    const dateRange = document.getElementById('aptDateRangeLabel');
    const today = manilaDateKey();
    const monthKey = today.slice(0, 7);
    const monthAppointments = APPOINTMENTS.filter((appointment) => appointment.dateKey.startsWith(monthKey));

    if (timelineDate) {
      timelineDate.textContent = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC'
      }).format(new Date(`${today}T00:00:00Z`));
    }
    if (dateRange) {
      const [year, month] = monthKey.split('-').map(Number);
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, 1)));
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      dateRange.textContent = `${monthName} 1 – ${monthName} ${lastDay}, ${year}`;
    }

    if (timeline) {
      timeline.textContent = '';
      const todaysAppointments = APPOINTMENTS.filter((appointment) => appointment.isToday);
      if (!todaysAppointments.length) {
        timeline.appendChild(el('li', 'apt-timeline__item', 'No appointments today.'));
      } else {
        todaysAppointments.slice(0, 6).forEach((appointment) => {
          const timelineClass = appointment.status === 'completed' ? 'done'
            : appointment.status === 'in-progress' ? 'live' : 'upcoming';
          const item = el('li', 'apt-timeline__item apt-timeline__item--' + timelineClass);
          item.appendChild(el('span', 'apt-timeline__dot'));
          item.appendChild(el('span', 'apt-timeline__time', appointment.time));
          const event = el('div', 'apt-timeline__event', appointment.client + ' · ' + appointment.service);
          event.appendChild(el('small', '', STATUS_LABELS[appointment.status] || appointment.status.toUpperCase()));
          item.appendChild(event);
          timeline.appendChild(item);
        });
      }
    }

    if (breakdown) {
      const statusRows = [
        ['completed', 'Completed', 'var(--um-role-client)'],
        ['confirmed', 'Confirmed', 'var(--um-status-active)'],
        ['in-progress', 'In progress', 'var(--um-role-doctor)'],
        ['cancelled', 'Cancelled', '#B96B6B'],
        ['no-show', 'No show', '#8a4545']
      ];
      breakdown.textContent = '';
      if (!APPOINTMENTS.length) {
        breakdown.appendChild(el('p', 'apt-sub', isLoading ? 'Loading appointment statuses…' : 'No appointments recorded.'));
      } else {
        statusRows.forEach(([status, label, color]) => {
          const count = APPOINTMENTS.filter((appointment) => appointment.status === status).length;
          if (!count) return;
          const row = el('div', 'apt-breakdown__row');
          const values = el('div');
          values.appendChild(el('span', '', label));
          values.appendChild(el('span', '', String(count)));
          const bar = el('div', 'apt-bar');
          const fill = el('i');
          fill.style.width = Math.round((count / APPOINTMENTS.length) * 100) + '%';
          fill.style.background = color;
          bar.appendChild(fill);
          row.appendChild(values);
          row.appendChild(bar);
          breakdown.appendChild(row);
        });
      }
    }

    if (totalCount) totalCount.textContent = String(APPOINTMENTS.length) + ' appointments';
    if (topServices) {
      const counts = new Map();
      monthAppointments.forEach((appointment) => counts.set(appointment.service, (counts.get(appointment.service) || 0) + 1));
      const leaders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      topServices.textContent = '';
      if (!leaders.length) {
        topServices.appendChild(el('li', '', isLoading ? 'Loading services…' : 'No bookings this month.'));
      } else {
        leaders.forEach(([service, count], index) => {
          const row = el('li');
          row.appendChild(el('span', '', (index + 1) + '. ' + service));
          row.appendChild(el('strong', '', count + (count === 1 ? ' booking' : ' bookings')));
          topServices.appendChild(row);
        });
      }
    }
  }

  async function loadAppointments() {
    if (requestInProgress) return;
    requestInProgress = true;
    try {
      const response = await fetch('/api/appointments/admin', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) {
        let message = 'Could not load appointments.';
        try {
          const body = await response.json();
          message = body.message || message;
        } catch (error) {
          const body = await response.text();
          if (body) message = body;
        }
        throw new Error(message);
      }

      const records = await response.json();
      if (!Array.isArray(records)) throw new Error('The appointments response was invalid.');
      APPOINTMENTS = records.map(normalizeAppointment);
      loadError = '';
    } catch (error) {
      loadError = error.message || 'Could not load appointments.';
    } finally {
      requestInProgress = false;
      isLoading = false;
      render();
      if (cancelledModal?.classList.contains('apt-modal-overlay--open')) renderCancelledModal();
    }
  }

  // ---------- events ----------

  tabsWrap.addEventListener('click', (event) => {
    const tab = event.target.closest('.um-tab');
    if (!tab) return;
    state.status = tab.dataset.status;
    state.todayOnly = false;
    state.page = 1;
    render();
  });

  // "View" links on the summary cards
  document.querySelectorAll('[data-apt-filter]').forEach((link) => {
    link.addEventListener('click', () => {
      const key = link.dataset.aptFilter;
      state.page = 1;
      if (key === 'today') {
        state.status = 'all';
        state.todayOnly = true;
      } else {
        state.status = key;
        state.todayOnly = false;
      }
      render();
      const card = document.getElementById('aptTableCard');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (todayChip) {
    todayChip.addEventListener('click', () => {
      state.todayOnly = false;
      state.page = 1;
      render();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      state.page = 1;
      render();
    });
  }

  render();

  // ---------- Cancelled Appointments modal ----------

  const cancelledModal = document.getElementById('aptCancelledModal');
  const cancelledViewBtn = document.getElementById('aptCancelledViewBtn');
  const cancelledClose = document.getElementById('aptCancelledClose');
  const cancelledBody = document.getElementById('aptCancelledBody');
  const cancelledPills = document.getElementById('aptCancelledPills');
  const cancelledSubtitle = document.getElementById('aptCancelledSubtitle');
  const reasonList = document.getElementById('aptReasonList');
  const sumCollected = document.getElementById('aptSumCollected');
  const sumRefunded = document.getElementById('aptSumRefunded');
  const sumForfeited = document.getElementById('aptSumForfeited');
  const cancellationRequestsModal = document.getElementById('cancellationRequestsModal');
  const cancellationRequestsBtn = document.getElementById('cancellationRequestsBtn');
  const cancellationRequestsClose = document.getElementById('cancellationRequestsClose');
  const cancellationRequestsList = document.getElementById('cancellationRequestsList');
  const cancellationRequestsSubtitle = document.getElementById('cancellationRequestsSubtitle');

  if (!cancelledModal || !cancelledViewBtn || !cancelledBody || !cancelledPills || !reasonList) return;

  function formatFee(amount) {
    return '₱' + amount.toLocaleString('en-US');
  }

  function formatMoney(amount) {
    return '₱' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildCancelledRow(a) {
    const tr = el('tr', 'apt-cancel-row');

    const refTd = el('td');
    const refBox = el('div', 'apt-ref');
    refBox.appendChild(el('strong', '', a.ref));
    refBox.appendChild(el('span', '', a.date));
    refTd.appendChild(refBox);

    const clientTd = el('td');
    const clientBox = el('div', 'um-user-cell');
    clientBox.appendChild(el('div', 'um-avatar um-avatar--muted', getInitials(a.client)));
    const clientInfo = el('div');
    clientInfo.appendChild(el('span', 'apt-name', a.client));
    clientInfo.appendChild(el('span', 'apt-sub', a.profile));
    clientBox.appendChild(clientInfo);
    clientTd.appendChild(clientBox);

    const serviceTd = stackCell(a.service, a.duration + ' · ' + formatFee(a.fee), 'apt-name');
    const schedTd = el('td');
    schedTd.appendChild(el('span', 'apt-name', a.date + ' · ' + a.time));

    const statusTd = el('td');
    statusTd.appendChild(el('span', 'apt-status apt-status--cancelled', STATUS_LABELS[a.status] || a.status.toUpperCase()));

    const paymentTd = el('td');
    const paymentStatus = a.paymentStatus;
    const paymentLabel = paymentStatus.replace(/_/g, ' ').toUpperCase();
    const isSettled = paymentStatus === 'paid' || paymentStatus === 'refunded';
    paymentTd.appendChild(el('span', 'apt-status ' + (isSettled ? 'apt-status--confirmed' : 'apt-status--cancelled'), paymentLabel));
    paymentTd.appendChild(el('span', 'apt-sub', formatFee(a.depositAmount) + ' reservation fee'));

    [refTd, clientTd, serviceTd, schedTd, statusTd, paymentTd].forEach((td) => tr.appendChild(td));
    return tr;
  }

  function renderCancelledModal() {
    const cancelledAppointments = APPOINTMENTS.filter((appointment) => appointment.status === 'cancelled');
    const total = cancelledAppointments.length;
    const paid = cancelledAppointments.filter((appointment) => appointment.paymentStatus === 'paid');
    const refunded = cancelledAppointments.filter((appointment) => appointment.paymentStatus === 'refunded');
    const outstanding = cancelledAppointments.filter((appointment) => ['unpaid', 'pending', 'failed'].includes(appointment.paymentStatus));
    const sumDeposits = (list) => list.reduce((acc, appointment) => acc + appointment.depositAmount, 0);
    cancelledSubtitle.textContent = 'All recorded dates · ' + total + ' cancelled';

    cancelledPills.textContent = '';
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--red', total + ' Cancelled'));
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--gold', paid.length + ' Paid'));
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--gold', refunded.length + ' Refunded'));

    cancelledBody.textContent = '';
    if (isLoading && !APPOINTMENTS.length) {
      const row = el('tr');
      row.appendChild(el('td', 'apt-empty', 'Loading cancelled appointments…'));
      row.firstChild.colSpan = 6;
      cancelledBody.appendChild(row);
    } else if (!total) {
      const row = el('tr');
      row.appendChild(el('td', 'apt-empty', 'No cancelled appointments found.'));
      row.firstChild.colSpan = 6;
      cancelledBody.appendChild(row);
    } else {
      cancelledAppointments.forEach((appointment) => cancelledBody.appendChild(buildCancelledRow(appointment)));
    }

    sumCollected.textContent = formatMoney(sumDeposits(paid));
    sumRefunded.textContent = formatMoney(sumDeposits(refunded));
    sumForfeited.textContent = formatMoney(sumDeposits(outstanding));

    reasonList.textContent = '';
    const paymentStatuses = ['paid', 'refunded', 'pending', 'unpaid', 'failed'];
    paymentStatuses.forEach((status) => {
      const count = cancelledAppointments.filter((appointment) => appointment.paymentStatus === status).length;
      if (!count || !total) return;
      const percent = Math.round((count / total) * 100);
      const row = el('div', 'apt-reason-row');
      const track = el('span', 'apt-reason-track');
      const fill = el('i', 'apt-reason-fill apt-reason-fill--' + (status === 'paid' || status === 'refunded' ? 'personal' : 'noshow'));
      fill.style.width = percent + '%';
      track.appendChild(fill);
      row.appendChild(el('span', '', status.charAt(0).toUpperCase() + status.slice(1)));
      row.appendChild(track);
      row.appendChild(el('span', 'apt-reason-count', count + ' (' + percent + '%)'));
      reasonList.appendChild(row);
    });
    if (!total) reasonList.appendChild(el('p', 'apt-sub', 'Payment totals will appear when cancellations are recorded.'));
  }

  function openCancelledModal() {
    renderCancelledModal();
    cancelledModal.classList.add('apt-modal-overlay--open');
    document.body.classList.add('modal-open');
    if (cancelledClose) cancelledClose.focus();
  }

  function closeCancelledModal() {
    cancelledModal.classList.remove('apt-modal-overlay--open');
    document.body.classList.remove('modal-open');
    cancelledViewBtn.focus();
  }

  function formatRequestDate(value) {
    if (!value) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function renderCancellationRequests(requests) {
    cancellationRequestsList.textContent = '';
    cancellationRequestsSubtitle.textContent = requests.length + (requests.length === 1 ? ' pending request' : ' pending requests');
    if (!requests.length) {
      cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', 'No pending cancellation requests.'));
      return;
    }
    requests.forEach((request) => {
      const card = el('article', 'cancellation-request-card');
      const requestType = request.request_type || 'cancellation';
      const title = el('div', 'cancellation-request-card__title');
      title.appendChild(el('strong', '', (requestType === 'reschedule' ? 'Reschedule' : 'Cancellation') + ' · ' + (request.client || 'Client')));
      title.appendChild(el('span', 'apt-sub', 'Appointment #' + request.appointment_id));
      card.appendChild(title);
      card.appendChild(el('p', 'apt-sub', [request.service, request.date, request.start, request.aesthetician].filter(Boolean).join(' · ')));
      if (requestType === 'reschedule') {
        card.appendChild(el('p', 'cancellation-request-card__reason', 'Proposed schedule: ' + [request.requested_date, request.requested_time].filter(Boolean).join(' · ')));
      }
      card.appendChild(el('p', 'cancellation-request-card__reason', 'Reason: ' + (request.request_reason || '—')));
      card.appendChild(el('p', 'cancellation-request-card__description', request.request_description || '—'));
      card.appendChild(el('p', 'apt-sub', 'Requested ' + formatRequestDate(request.requested_at)));
      const actions = el('div', 'cancellation-request-card__actions');
      const reject = el('button', 'um-btn um-btn--ghost', 'Reject');
      const allow = el('button', 'um-btn um-btn--primary', 'Allow');
      [reject, allow].forEach((button) => {
        button.type = 'button';
        button.addEventListener('click', async () => {
          reject.disabled = true;
          allow.disabled = true;
          try {
            const response = await fetch(`/api/appointments/${request.appointment_id}/cancellation-request/review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision: button === allow ? 'allow' : 'reject', requestType })
            });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || 'Could not review request.');
            await loadCancellationRequests();
            await loadAppointments();
          } catch (error) {
            window.alert(error.message);
            reject.disabled = false;
            allow.disabled = false;
          }
        });
      });
      actions.append(reject, allow);
      card.appendChild(actions);
      cancellationRequestsList.appendChild(card);
    });
  }

  async function loadCancellationRequests() {
    const response = await fetch('/api/appointments/admin/cancellation-requests', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.message || 'Could not load cancellation requests.');
    renderCancellationRequests(Array.isArray(data) ? data : []);
  }

  async function openCancellationRequests() {
    cancellationRequestsModal.classList.add('apt-modal-overlay--open');
    document.body.classList.add('modal-open');
    cancellationRequestsList.textContent = '';
    cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', 'Loading requests…'));
    try { await loadCancellationRequests(); } catch (error) { cancellationRequestsList.textContent = ''; cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', error.message)); }
    cancellationRequestsClose.focus();
  }

  function closeCancellationRequests() {
    cancellationRequestsModal.classList.remove('apt-modal-overlay--open');
    document.body.classList.remove('modal-open');
  }

  cancelledViewBtn.addEventListener('click', openCancelledModal);
  if (cancelledClose) cancelledClose.addEventListener('click', closeCancelledModal);

  cancelledModal.addEventListener('click', (event) => {
    if (event.target === cancelledModal) closeCancelledModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cancelledModal.classList.contains('apt-modal-overlay--open')) {
      closeCancelledModal();
    }
  });

  cancellationRequestsBtn.addEventListener('click', openCancellationRequests);
  cancellationRequestsClose.addEventListener('click', closeCancellationRequests);
  cancellationRequestsModal.addEventListener('click', (event) => {
    if (event.target === cancellationRequestsModal) closeCancellationRequests();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cancellationRequestsModal.classList.contains('apt-modal-overlay--open')) closeCancellationRequests();
  });

  loadAppointments();
  window.setInterval(() => {
    if (!document.hidden) loadAppointments();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadAppointments();
  });
});