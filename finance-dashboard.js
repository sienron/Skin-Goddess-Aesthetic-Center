(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const today = common.manilaToday();
  const from = common.monthStart(today);
  const ids = ['dashboardMonthLabel', 'dashSales', 'dashCollected', 'dashExpenses', 'dashNet', 'dashOutstanding', 'dashToday', 'dashReceivables', 'dashNoShows', 'dashboardRecentRows', 'dashboardRecentEmpty', 'dashboardMessage'];
  const refs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

  function cell(row, value) {
    const td = document.createElement('td');
    td.textContent = value == null ? '-' : String(value);
    row.append(td);
  }

  async function load() {
    refs.dashboardMonthLabel.textContent = `${from.slice(0, 7)}`;
    const query = common.rangeParams(from, today);
    const [summary, monthly, daily, transactionData, expenseData, receivables] = await Promise.all([
      common.fetchJson(`/api/finance/summary?${query}`),
      common.fetchJson('/api/finance/monthly?months=6'),
      common.fetchJson(`/api/finance/daily?${query}`),
      common.fetchJson(`/api/finance/transactions?${common.rangeParams(from, today, { limit: 100 })}`),
      common.fetchJson(`/api/finance/expenses?${common.rangeParams(from, today, { limit: 100 })}`),
      common.fetchJson('/api/finance/receivables'),
    ]);
    refs.dashSales.textContent = common.formatPeso(summary.sales);
    refs.dashCollected.textContent = common.formatPeso(summary.collected);
    refs.dashExpenses.textContent = common.formatPeso(summary.expenses);
    refs.dashNet.textContent = common.formatPeso(summary.net_income);
    refs.dashOutstanding.textContent = common.formatPeso(summary.outstanding_balance);
    refs.dashToday.textContent = common.formatPeso(summary.today_collections);
    refs.dashReceivables.textContent = String(receivables.length);
    refs.dashNoShows.textContent = String(summary.no_shows_this_week);

    common.renderChart('dashboardMonthlyChart', {
      type: 'bar',
      data: {
        labels: monthly.map((item) => item.month),
        datasets: [
          { label: 'Sales', data: monthly.map((item) => Number(item.sales)), backgroundColor: '#C9A84C', borderRadius: 3 },
          { label: 'Expenses', data: monthly.map((item) => Number(item.expenses)), backgroundColor: '#B93C3C', borderRadius: 3 },
        ],
      },
      options: { scales: { x: { stacked: false }, y: { beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${common.formatPeso(item.raw)}` } } } },
    });
    common.renderChart('dashboardDailyChart', {
      type: 'line',
      data: { labels: daily.map((item) => item.date.slice(5)), datasets: [{ label: 'Collected', data: daily.map((item) => Number(item.collected)), borderColor: '#228B46', backgroundColor: 'rgba(34,139,70,.12)', fill: true, tension: 0.25, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => common.formatPeso(item.raw) } } } },
    });

    const activity = [
      ...transactionData.rows.map((item) => ({ date: item.payment_date, label: `${item.payment_type.replace('_', ' ')} payment`, group: item.method, amount: Number(item.amount), status: item.status })),
      ...expenseData.rows.map((item) => ({ date: item.expense_date, label: item.description, group: item.category, amount: -Number(item.amount), status: item.voided_at ? 'voided' : 'active' })),
    ].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 10);
    refs.dashboardRecentRows.replaceChildren();
    activity.forEach((item) => {
      const row = document.createElement('tr');
      if (item.status === 'voided') row.className = 'fin-row-voided';
      cell(row, item.date); cell(row, item.label); cell(row, item.group); cell(row, common.formatPeso(item.amount)); cell(row, item.status);
      refs.dashboardRecentRows.append(row);
    });
    refs.dashboardRecentEmpty.hidden = activity.length > 0;
  }

  load().catch((error) => { refs.dashboardMessage.textContent = error.message; });
})();