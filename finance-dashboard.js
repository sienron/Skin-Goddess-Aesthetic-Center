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
  ];
  const refs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const state = { from: common.monthStart(today), to: today };
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
    refs.dashSalesComparison.textContent = common.formatComparison(summary.sales, previousSummary.sales);
    refs.dashCollectedComparison.textContent = common.formatComparison(summary.collected, previousSummary.collected);
    refs.dashExpensesComparison.textContent = common.formatComparison(summary.expenses, previousSummary.expenses);
    refs.dashNetComparison.textContent = common.formatComparison(summary.net_income, previousSummary.net_income);
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
      refs.appointmentTrendsMessage.textContent = hasAppointments ? '' : 'No appointments recorded for this period.';
    } catch (error) {
      refs.appointmentTrendsMessage.textContent = `Could not load appointment trends: ${error.message}`;
    }
  }

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
})();