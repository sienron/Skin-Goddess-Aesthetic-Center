(function () {
  const charts = new Map();
  const modalFocus = new WeakMap();
  const boundModals = new WeakSet();

  function formatPeso(value) {
    const amount = Number(value);
    return new Intl.NumberFormat('en-PH', {
      style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  function paymentMethodLabel(method) {
    const labels = {
      paymongo: 'PayMongo (Other)',
      cash: 'Cash',
      gcash: 'GCash',
      maya: 'Maya',
      card: 'Credit/debit card',
    };
    return labels[String(method || '').toLowerCase()] || String(method || 'Unknown');
  }

  function manilaToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function monthStart(date = manilaToday()) {
    return `${date.slice(0, 7)}-01`;
  }

  function lastMonthRange(today = manilaToday()) {
    const [year, month] = today.slice(0, 7).split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 2, 1));
    const last = new Date(Date.UTC(year, month - 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }

  function periodRange(kind, today = manilaToday()) {
    if (kind === 'today') return { from: today, to: today };
    if (kind === 'month') return { from: monthStart(today), to: today };
    if (kind === 'last-month') return lastMonthRange(today);
    return null;
  }

  function isValidRange(from, to) {
    const validDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    return validDate(from) && validDate(to) && from <= to;
  }

  function previousRange(from, to) {
    if (!isValidRange(from, to)) throw new RangeError('A valid date range is required.');
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    if (from.slice(-2) === '01' && from.slice(0, 7) === to.slice(0, 7)) {
      const [year, month] = from.slice(0, 7).split('-').map(Number);
      const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
      const previousFrom = new Date(Date.UTC(year, month - 2, 1));
      const previousTo = new Date(Date.UTC(
        previousMonthEnd.getUTCFullYear(),
        previousMonthEnd.getUTCMonth(),
        Math.min(toDate.getUTCDate(), previousMonthEnd.getUTCDate())
      ));
      return {
        from: previousFrom.toISOString().slice(0, 10),
        to: previousTo.toISOString().slice(0, 10),
      };
    }
    const days = Math.round((toDate - fromDate) / 86400000) + 1;
    const previousTo = new Date(fromDate);
    previousTo.setUTCDate(previousTo.getUTCDate() - 1);
    const previousFrom = new Date(previousTo);
    previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1);
    return {
      from: previousFrom.toISOString().slice(0, 10),
      to: previousTo.toISOString().slice(0, 10),
    };
  }

  function formatComparison(currentValue, previousValue) {
    const current = Number(currentValue) || 0;
    const previous = Number(previousValue) || 0;
    const difference = current - previous;
    if (difference === 0) return 'No change vs previous period';
    const change = difference > 0 ? 'Increase' : 'Decrease';
    const detail = `${change} of ${formatPeso(Math.abs(difference))}`;
    if (previous === 0) return `${detail}; no previous-period activity`;
    return `${detail} (${(Math.abs(difference / Math.abs(previous)) * 100).toFixed(1)}%) vs previous period`;
  }

  function bindPeriodControls({ fromInput, toInput, buttons, onChange, onInvalid }) {
    const buttonList = Array.from(buttons || []);
    const activate = (kind) => {
      buttonList.forEach((button) => button.classList.toggle('is-active', button.dataset.period === kind));
    };
    const applyRange = (from, to) => {
      fromInput.value = from;
      toInput.value = to;
      fromInput.max = to;
      toInput.min = from;
      fromInput.removeAttribute('aria-invalid');
      toInput.removeAttribute('aria-invalid');
      activate('custom');
      if (!isValidRange(from, to)) {
        fromInput.setAttribute('aria-invalid', 'true');
        toInput.setAttribute('aria-invalid', 'true');
        onInvalid?.('Choose a valid date range with the start date on or before the end date.');
        return;
      }
      onChange({ from, to });
    };
    const setPeriod = (kind) => {
      if (kind === 'custom') {
        activate(kind);
        fromInput.focus();
        return;
      }
      const range = periodRange(kind);
      if (!range) return;
      activate(kind);
      applyRange(range.from, range.to);
      activate(kind);
    };
    buttonList.forEach((button) => button.addEventListener('click', () => setPeriod(button.dataset.period)));
    [fromInput, toInput].forEach((input) => input.addEventListener('change', () => {
      applyRange(fromInput.value, toInput.value);
    }));
    return { setPeriod };
  }

  function rangeParams(from, to, extras = {}) {
    return new URLSearchParams({ from, to, ...extras }).toString();
  }

  async function fetchJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    } catch (error) {
      throw new Error('Unable to reach the server. Check your connection and try again.');
    }
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.message : '';
      throw new Error(message || `Request failed (${response.status}).`);
    }
    return payload;
  }

  function statusBadge(status) {
    const labels = {
      active: 'Active',
      cancelled: 'Cancelled',
      completed: 'Completed',
      forfeited: 'Forfeited',
      paid: 'Paid',
      pending: 'Pending',
      posted: 'Posted',
      refunded: 'Refunded',
      reversed: 'Reversed',
      voided: 'Voided',
    };
    const normalized = String(status || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const label = labels[normalized] || normalized.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const badge = document.createElement('span');
    badge.className = `fin-status-badge fin-status-badge--${normalized}`;
    badge.textContent = label;
    badge.setAttribute('aria-label', `Status: ${label}`);
    return badge;
  }

  function bindAccessibleModal(modal) {
    if (!modal || boundModals.has(modal)) return;
    boundModals.add(modal);
    modal.addEventListener('keydown', (event) => {
      if (modal.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAccessibleModal(modal);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.closest('[hidden]'));
      if (!focusable.length) {
        event.preventDefault();
        modal.querySelector('[role="dialog"]')?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function openAccessibleModal(modal) {
    if (!modal) return;
    bindAccessibleModal(modal);
    modalFocus.set(modal, document.activeElement);
    modal.hidden = false;
    const dialog = modal.querySelector('[role="dialog"]');
    const focusable = modal.querySelector(
      '[autofocus], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]'
    );
    const target = focusable || dialog;
    if (dialog && target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    target?.focus();
  }

  function closeAccessibleModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    const previous = modalFocus.get(modal);
    modalFocus.delete(modal);
    if (previous?.isConnected) previous.focus();
  }

  function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const frame = canvas.closest('.fin-chart-frame');
    if (!frame) return null;
    const datasets = Array.isArray(config.data?.datasets) ? config.data.datasets : [];
    const hasData = datasets.some((dataset) => (dataset.data || []).some((value) => Number.isFinite(Number(value)) && Number(value) !== 0));
    const existing = charts.get(canvasId);
    let empty = frame.querySelector('.fin-chart-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'fin-chart-empty';
      empty.setAttribute('role', 'status');
      empty.setAttribute('aria-live', 'polite');
      frame.append(empty);
    }
    if (!window.Chart) {
      existing?.destroy();
      charts.delete(canvasId);
      canvas.hidden = true;
      empty.hidden = false;
      empty.textContent = 'Charts are unavailable right now.';
      return null;
    }
    empty.hidden = hasData;
    canvas.hidden = !hasData;
    if (!hasData) {
      existing?.destroy();
      charts.delete(canvasId);
      empty.textContent = 'No data for this period';
      return null;
    }
    const normalized = {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...config.options,
      },
    };
    if (['bar', 'line'].includes(normalized.type)) {
      normalized.options.scales = { ...normalized.options.scales };
      const axis = normalized.options.indexAxis === 'y' ? 'x' : 'y';
      normalized.options.scales[axis] = { beginAtZero: true, ...normalized.options.scales[axis] };
    }
    if (existing && existing.config.type === normalized.type) {
      existing.data = normalized.data;
      existing.options = normalized.options;
      existing.update();
      return existing;
    }
    existing?.destroy();
    const chart = new window.Chart(canvas, normalized);
    charts.set(canvasId, chart);
    return chart;
  }

  window.FinanceCommon = Object.freeze({
    formatPeso,
    paymentMethodLabel,
    manilaToday,
    monthStart,
    lastMonthRange,
    periodRange,
    isValidRange,
    previousRange,
    formatComparison,
    bindPeriodControls,
    rangeParams,
    fetchJson,
    statusBadge,
    bindAccessibleModal,
    openAccessibleModal,
    closeAccessibleModal,
    renderChart,
  });
})();