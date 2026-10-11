(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const today = common.manilaToday();
  const ids = [
    'dashboardFrom', 'dashboardTo', 'dashboardMonthLabel', 'dashSales', 'dashCollected', 'dashExpenses', 'dashNet',
    'dashSalesComparison', 'dashCollectedComparison', 'dashExpensesComparison', 'dashNetComparison',
    'dashOutstanding', 'dashToday', 'dashReceivables', 'dashNoShows',
    'dashboardRecentRows', 'dashboardRecentEmpty', 'dashboardMessage',
    'appointmentTrendsChart', 'appointmentTrendsMessage',
    'cashClosingDate', 'cashClosingExpected', 'cashClosingVariance', 'cashClosingActual',
    'cashClosingForm', 'cashClosingSubmit', 'cashClosingMessage',
    'cashClosingHistoryRows', 'cashClosingHistoryEmpty', 'cashClosingHistoryMessage',
  ];
  const refs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const state = { from: common.monthStart(today), to: today };
  let expectedCash = null;
  let cashDateRequest = 0;
  let overviewRequest = 0;

  function cell(row, value) {
    const td = document.createElement('td');
    td.textContent = value == null ? '-' : String(value);
    row.append(td);
  }

  async function loadOverview() {
    const requestId = ++overviewRequest;
    const previous = common.previousRange(state.from, state.to);
    refs.dashboardMonthLabel.textContent = `${state.from} to ${state.to}`;
    refs.dashboardMessage.textContent = 'Loading finance overview...';
    const query = common.rangeParams(state.from, state.to);
    const [summary, previousSummary, monthly, daily, activityData, receivables] = await Promise.all([
      common.fetchJson(`/api/finance/summary?${query}`),
      common.fetchJson(`/api/finance/summary?${common.rangeParams(previous.from, previous.to)}`),
      common.fetchJson('/api/finance/monthly?months=6'),
      common.fetchJson(`/api/finance/daily?${query}`),
      common.fetchJson(`/api/finance/activity?${common.rangeParams(state.from, state.to, { limit: 10 })}`),
      common.fetchJson('/api/finance/receivables'),
    ]);
    if (requestId !== overviewRequest) return;
    refs.dashSales.textContent = common.formatPeso(summary.sales);
    refs.dashCollected.textContent = common.formatPeso(summary.collected);
    refs.dashExpenses.textContent = common.formatPeso(summary.expenses);
    refs.dashNet.textContent = common.formatPeso(summary.net_income);
    refs.dashSalesComparison.textContent = `${common.formatComparison(summary.sales, previousSummary.sales)} · previous ${previous.from} to ${previous.to}`;
    refs.dashCollectedComparison.textContent = `${common.formatComparison(summary.collected, previousSummary.collected)} · previous ${previous.from} to ${previous.to}`;
    refs.dashExpensesComparison.textContent = `${common.formatComparison(summary.expenses, previousSummary.expenses)} · previous ${previous.from} to ${previous.to}`;
    refs.dashNetComparison.textContent = `${common.formatComparison(summary.net_income, previousSummary.net_income)} · previous ${previous.from} to ${previous.to}`;
    refs.dashOutstanding.textContent = common.formatPeso(summary.outstanding_balance);
    refs.dashToday.textContent = common.formatPeso(summary.today_collections);
    refs.dashReceivables.textContent = String(receivables.length);
    refs.dashNoShows.textContent = String(summary.no_shows_this_week);

    common.renderChart('dashboardMonthlyChart', {
      type: 'bar',
      data: {
        labels: monthly.map((item) => item.month),
        datasets: [
          { label: 'Sales earned', data: monthly.map((item) => Number(item.sales)), backgroundColor: '#C9A84C', borderRadius: 3 },
          { label: 'Recorded expenses', data: monthly.map((item) => Number(item.expenses)), backgroundColor: '#B93C3C', borderRadius: 3 },
        ],
      },
      options: { scales: { x: { stacked: false }, y: { beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${common.formatPeso(item.raw)}` } } } },
    });
    common.renderChart('dashboardDailyChart', {
      type: 'line',
      data: { labels: daily.map((item) => item.date.slice(5)), datasets: [{ label: 'Posted collections', data: daily.map((item) => Number(item.collected)), borderColor: '#228B46', backgroundColor: 'rgba(34,139,70,.12)', fill: true, tension: 0.25, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => common.formatPeso(item.raw) } } } },
    });

    const activity = activityData.rows || [];
    refs.dashboardRecentRows.replaceChildren();
    activity.forEach((item) => {
      const row = document.createElement('tr');
      if (['voided', 'refunded', 'reversed'].includes(item.status)) row.className = 'fin-row-voided';
      const isExpense = item.activity_type === 'expense';
      const label = isExpense
        ? 'Expense recorded'
        : `${String(item.category || 'payment').replace('_', ' ')} payment`;
      const category = isExpense ? item.category : common.paymentMethodLabel(item.method);
      const amount = (isExpense ? -1 : 1) * Number(item.amount);
      cell(row, item.activity_date);
      cell(row, label);
      cell(row, category);
      cell(row, common.formatPeso(amount));
      const status = document.createElement('td');
      status.append(common.statusBadge(item.status));
      row.append(status);
      refs.dashboardRecentRows.append(row);
    });
    refs.dashboardRecentEmpty.hidden = activity.length > 0;
    refs.dashboardMessage.textContent = '';
  }

  async function loadAppointmentTrends() {
    refs.appointmentTrendsMessage.textContent = 'Loading appointment trends...';
    refs.appointmentTrendsChart.hidden = true;
    try {
      const result = await common.fetchJson('/api/finance/appointment-trends?months=6');
      const rows = result.rows || [];
      const hasAppointments = rows.some((row) => Number(row.total) > 0);
      common.renderChart('appointmentTrendsChart', {
        type: 'bar',
        data: {
          labels: rows.map((row) => row.month),
          datasets: [
            { label: 'Completed', data: rows.map((row) => Number(row.completed)), backgroundColor: '#228B46', borderRadius: 3 },
            { label: 'Confirmed', data: rows.map((row) => Number(row.confirmed)), backgroundColor: '#C9A84C', borderRadius: 3 },
            { label: 'Cancelled', data: rows.map((row) => Number(row.cancelled)), backgroundColor: '#B93C3C', borderRadius: 3 },
            { label: 'No-show', data: rows.map((row) => Number(row.no_show)), backgroundColor: '#756C62', borderRadius: 3 },
          ],
        },
        options: {
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
          plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${item.raw}` } } },
        },
      });
      refs.appointmentTrendsChart.hidden = !hasAppointments;
      refs.appointmentTrendsMessage.textContent = hasAppointments
        ? `Appointments by date from ${result.from} to ${result.to}. Completed counts include completed appointments only.`
        : 'No appointments recorded for this period.';
    } catch (error) {
      refs.appointmentTrendsMessage.textContent = `Could not load appointment trends: ${error.message}`;
    }
  }

  function renderCashVariance() {
    const entered = refs.cashClosingActual.value;
    if (expectedCash === null || entered === '' || !Number.isFinite(Number(entered))) {
      refs.cashClosingVariance.textContent = '—';
      return;
    }
    const variance = Math.round((Number(entered) - expectedCash) * 100) / 100;
    const sign = variance > 0 ? '+' : variance < 0 ? '-' : '';
    refs.cashClosingVariance.textContent = `${sign}${common.formatPeso(Math.abs(variance))}`;
  }

  async function loadCashClosing() {
    const requestId = ++cashDateRequest;
    const businessDate = refs.cashClosingDate.value;
    refs.cashClosingMessage.textContent = 'Loading cash closing...';
    refs.cashClosingSubmit.disabled = true;
    refs.cashClosingActual.disabled = true;
    try {
      const result = await common.fetchJson(`/api/finance/cash-closing?date=${encodeURIComponent(businessDate)}`);
      if (requestId !== cashDateRequest) return;
      expectedCash = Number(result.expected_amount);
      refs.cashClosingExpected.textContent = common.formatPeso(expectedCash);
      if (result.closing) {
        refs.cashClosingActual.value = Number(result.closing.actual_amount).toFixed(2);
        refs.cashClosingActual.disabled = true;
        refs.cashClosingSubmit.disabled = true;
        refs.cashClosingMessage.textContent = `Closed by ${result.closing.closed_by_name || 'authorized user'}. This date cannot be revised.`;
      } else {
        refs.cashClosingActual.value = '';
        refs.cashClosingActual.disabled = false;
        refs.cashClosingSubmit.disabled = false;
        refs.cashClosingMessage.textContent = 'No closing recorded for this date.';
      }
      renderCashVariance();
    } catch (error) {
      if (requestId !== cashDateRequest) return;
      expectedCash = null;
      refs.cashClosingExpected.textContent = '—';
      refs.cashClosingVariance.textContent = '—';
      refs.cashClosingActual.disabled = true;
      refs.cashClosingSubmit.disabled = true;
      refs.cashClosingMessage.textContent = error.message;
    }
  }

  async function loadCashClosingHistory() {
    refs.cashClosingHistoryMessage.textContent = 'Loading cash closings…';
    try {
      const result = await common.fetchJson('/api/finance/cash-closing/history?limit=10');
      const rows = result.rows || [];
      refs.cashClosingHistoryRows.replaceChildren();
      rows.forEach((item) => {
        const row = document.createElement('tr');
        cell(row, item.business_date);
        cell(row, common.formatPeso(item.expected_amount));
        cell(row, common.formatPeso(item.actual_amount));
        const variance = Number(item.variance);
        const sign = variance > 0 ? '+' : variance < 0 ? '-' : '';
        cell(row, `${sign}${common.formatPeso(Math.abs(variance))}`);
        cell(row, item.closed_by_name);
        refs.cashClosingHistoryRows.append(row);
      });
      refs.cashClosingHistoryEmpty.hidden = rows.length > 0;
      refs.cashClosingHistoryMessage.textContent = '';
    } catch (error) {
      refs.cashClosingHistoryRows.replaceChildren();
      refs.cashClosingHistoryEmpty.hidden = true;
      refs.cashClosingHistoryMessage.textContent = `Could not load cash closings: ${error.message}`;
    }
  }

  refs.cashClosingDate.max = today;
  refs.cashClosingDate.value = today;
  refs.cashClosingActual.addEventListener('input', renderCashVariance);
  refs.cashClosingDate.addEventListener('change', loadCashClosing);
  refs.cashClosingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const actualAmount = Number(refs.cashClosingActual.value);
    const variance = Math.round((actualAmount - expectedCash) * 100) / 100;
    const confirmed = window.confirm([
      `Close business date ${refs.cashClosingDate.value}?`,
      `Expected cash receipts: ${common.formatPeso(expectedCash)}.`,
      `Cash counted: ${common.formatPeso(actualAmount)}.`,
      `Variance: ${common.formatPeso(variance)}.`,
      'This closing is immutable. Additional cash receipts, refunds/reversals of cash payments, and expense changes for this date will be blocked.',
    ].join('\n'));
    if (!confirmed) return;
    refs.cashClosingSubmit.disabled = true;
    refs.cashClosingMessage.textContent = 'Recording cash closing...';
    try {
      const result = await common.fetchJson('/api/finance/cash-closing', {
        method: 'POST',
        body: JSON.stringify({
          business_date: refs.cashClosingDate.value,
          actual_amount: actualAmount.toFixed(2),
        }),
      });
      const variance = Number(result.closing.variance);
      refs.cashClosingMessage.textContent = `Cash closing recorded. Variance: ${common.formatPeso(variance)}.`;
      await Promise.all([loadCashClosing(), loadCashClosingHistory()]);
    } catch (error) {
      refs.cashClosingMessage.textContent = error.message;
      refs.cashClosingSubmit.disabled = false;
    }
  });

  refs.dashboardFrom.value = state.from;
  refs.dashboardTo.value = state.to;
  common.bindPeriodControls({
    fromInput: refs.dashboardFrom,
    toInput: refs.dashboardTo,
    buttons: document.querySelectorAll('[data-period]'),
    onChange: (range) => {
      state.from = range.from;
      state.to = range.to;
      loadOverview().catch((error) => { refs.dashboardMessage.textContent = `Could not load finance overview: ${error.message}`; });
    },
    onInvalid: (error) => { refs.dashboardMessage.textContent = error; },
  });
  loadOverview().catch((error) => {
    refs.dashboardRecentEmpty.hidden = true;
    refs.dashboardMessage.textContent = `Could not load finance overview: ${error.message}`;
  });
  loadAppointmentTrends();
  loadCashClosing();
  loadCashClosingHistory();
})();