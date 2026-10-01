(function () {
  const charts = new Map();

  function formatPeso(value) {
    const amount = Number(value);
    return new Intl.NumberFormat('en-PH', {
      style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  function manilaToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function monthStart(date = manilaToday()) {
    return `${date.slice(0, 7)}-01`;
  }

  function lastMonthRange() {
    const [year, month] = manilaToday().slice(0, 7).split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 2, 1));
    const last = new Date(Date.UTC(year, month - 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
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

  function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return null;
    const frame = canvas.closest('.fin-chart-frame');
    if (!frame) return null;
    const datasets = Array.isArray(config.data?.datasets) ? config.data.datasets : [];
    const hasData = datasets.some((dataset) => (dataset.data || []).some((value) => Number(value) > 0));
    charts.get(canvasId)?.destroy();
    charts.delete(canvasId);
    let empty = frame.querySelector('.fin-chart-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'fin-chart-empty';
      empty.textContent = 'No data for this period';
      frame.append(empty);
    }
    empty.hidden = hasData;
    canvas.hidden = !hasData;
    if (!hasData) return null;
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
    const chart = new Chart(canvas, normalized);
    charts.set(canvasId, chart);
    return chart;
  }

  window.FinanceCommon = Object.freeze({
    formatPeso,
    manilaToday,
    monthStart,
    lastMonthRange,
    rangeParams,
    fetchJson,
    renderChart,
  });
})();