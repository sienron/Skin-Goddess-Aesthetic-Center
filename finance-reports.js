(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const refs = Object.fromEntries(['reportPeriodLabel', 'reportFrom', 'reportTo', 'reportMessage', 'reportSales', 'reportCollected', 'reportExpenses', 'reportNet', 'reportDepositsReceived', 'reportDepositsReceivedCount', 'reportRefunds', 'reportRefundsCount', 'reportForfeited', 'reportForfeitedCount', 'dailyCashRows', 'dailyCashEmpty'].map((id) => [id, document.getElementById(id)]));
  const state = { from: common.monthStart(), to: common.manilaToday(), data: null, monthly: [], methods: [] };
  const colors = ['#C9A84C', '#228B46', '#4388E8', '#929292', '#8a6e2f', '#B93C3C'];

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value == null ? '-' : String(value);
    row.append(cell);
  }

  function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv(name, headers, rows) {
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = name;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function peso(value) { return common.formatPeso(value); }

  async function load() {
    refs.reportMessage.textContent = '';
    refs.reportPeriodLabel.textContent = `${state.from} to ${state.to}`;
    const monthCount = (Number(state.to.slice(0, 4)) - Number(state.from.slice(0, 4))) * 12 + Number(state.to.slice(5, 7)) - Number(state.from.slice(5, 7)) + 1;
    const range = common.rangeParams(state.from, state.to);
    const [report, monthly, methods] = await Promise.all([
      common.fetchJson(`/api/finance/report?${range}`),
      common.fetchJson(`/api/finance/monthly?${common.rangeParams(state.from, state.to, { months: Math.min(Math.max(monthCount, 1), 24) })}`),
      common.fetchJson(`/api/finance/by-method?${range}`),
    ]);
    state.data = report;
    state.monthly = monthly;
    state.methods = methods;
    const income = report.income_statement;
    refs.reportSales.textContent = peso(income.sales);
    refs.reportCollected.textContent = peso(income.collected);
    refs.reportExpenses.textContent = peso(income.expenses);
    refs.reportNet.textContent = peso(income.net_income);

    const depositByStatus = new Map(report.deposits.map((item) => [item.status, item]));
    const received = ['paid', 'forfeited'].map((status) => depositByStatus.get(status)).filter(Boolean);
    const refunded = depositByStatus.get('refunded') || { count: 0, amount: 0 };
    const forfeited = depositByStatus.get('forfeited') || { count: 0, amount: 0 };
    refs.reportDepositsReceived.textContent = peso(received.reduce((sum, item) => sum + Number(item.amount), 0));
    refs.reportDepositsReceivedCount.textContent = `${received.reduce((sum, item) => sum + Number(item.count), 0)} payments`;
    refs.reportRefunds.textContent = peso(refunded.amount);
    refs.reportRefundsCount.textContent = `${refunded.count} payments`;
    refs.reportForfeited.textContent = peso(forfeited.amount);
    refs.reportForfeitedCount.textContent = `${forfeited.count} payments`;

    common.renderChart('reportSalesExpensesChart', {
      type: 'bar', data: { labels: monthly.map((row) => row.month), datasets: [{ label: 'Sales', data: monthly.map((row) => Number(row.sales)), backgroundColor: '#C9A84C' }, { label: 'Expenses', data: monthly.map((row) => Number(row.expenses)), backgroundColor: '#B93C3C' }] },
      options: { plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${peso(item.raw)}` } } } },
    });
    common.renderChart('reportCollectionsChart', {
      type: 'line', data: { labels: report.daily_cash.map((row) => row.date), datasets: [{ label: 'Collected', data: report.daily_cash.map((row) => Number(row.collected)), borderColor: '#228B46', backgroundColor: 'rgba(34,139,70,.12)', fill: true, tension: 0.22, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });
    common.renderChart('reportServiceCategoryChart', {
      type: 'pie', data: { labels: report.service_categories.map((row) => row.category), datasets: [{ data: report.service_categories.map((row) => Number(row.amount)), backgroundColor: colors, borderWidth: 1, borderColor: '#fff' }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${peso(item.raw)}` } } } },
    });
    common.renderChart('reportDepositsChart', {
      type: 'doughnut', data: { labels: report.deposits.map((row) => row.status), datasets: [{ data: report.deposits.map((row) => Number(row.amount)), backgroundColor: ['#228B46', '#B93C3C', '#929292'], borderColor: '#fff', borderWidth: 1 }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${peso(item.raw)}` } } } },
    });
    common.renderChart('reportMethodsChart', {
      type: 'bar', data: { labels: methods.map((row) => common.paymentMethodLabel(row.method)), datasets: [{ label: 'Collected', data: methods.map((row) => Number(row.amount)), backgroundColor: '#C9A84C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });
    common.renderChart('reportTopServicesChart', {
      type: 'bar', data: { labels: report.top_services.map((row) => row.service), datasets: [{ label: 'Sales', data: report.top_services.map((row) => Number(row.amount)), backgroundColor: '#C9A84C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });
    common.renderChart('reportExpenseCategoryChart', {
      type: 'bar', data: { labels: report.expenses_by_category.map((row) => row.category), datasets: [{ label: 'Expenses', data: report.expenses_by_category.map((row) => Number(row.amount)), backgroundColor: '#B93C3C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });

    refs.dailyCashRows.replaceChildren();
    report.daily_cash.forEach((row) => {
      const tr = document.createElement('tr');
      addCell(tr, row.date); addCell(tr, peso(row.collected)); addCell(tr, peso(row.expenses)); addCell(tr, peso(Number(row.collected) - Number(row.expenses)));
      refs.dailyCashRows.append(tr);
    });
    refs.dailyCashEmpty.hidden = report.daily_cash.length > 0;
  }

  function setPeriod(kind) {
    const today = common.manilaToday();
    if (kind === 'today') state.from = state.to = today;
    else if (kind === 'month') { state.from = common.monthStart(today); state.to = today; }
    else if (kind === 'last-month') ({ from: state.from, to: state.to } = common.lastMonthRange());
    refs.reportFrom.value = state.from; refs.reportTo.value = state.to;
    document.querySelectorAll('[data-period]').forEach((button) => button.classList.toggle('is-active', button.dataset.period === kind));
    load().catch((error) => { refs.reportMessage.textContent = error.message; });
  }

  async function exportSection(section) {
    if (!state.data) return;
    const report = state.data;
    const income = report.income_statement;
    if (section === 'income-statement' || section === 'daily-cash') {
      window.location.href = `/api/finance/export.csv?${common.rangeParams(state.from, state.to, { section })}`;
      return;
    }
    if (section === 'payment-methods') downloadCsv('finance-payment-methods.csv', ['Method', 'Payment count', 'Collected (PHP)'], state.methods.map((row) => [common.paymentMethodLabel(row.method), row.count, peso(row.amount)]));
    if (section === 'sales-expenses') downloadCsv('finance-sales-vs-expenses.csv', ['Month', 'Sales (PHP)', 'Expenses (PHP)'], state.monthly.map((row) => [row.month, peso(row.sales), peso(row.expenses)]));
    if (section === 'collections') downloadCsv('finance-collections-trend.csv', ['Date', 'Collected (PHP)'], report.daily_cash.map((row) => [row.date, peso(row.collected)]));
    if (section === 'service-categories') downloadCsv('finance-service-categories.csv', ['Category', 'Sales (PHP)'], report.service_categories.map((row) => [row.category, peso(row.amount)]));
    if (section === 'deposits') downloadCsv('finance-deposit-summary.csv', ['Status', 'Count', 'Amount (PHP)'], report.deposits.map((row) => [row.status, row.count, peso(row.amount)]));
    if (section === 'top-services') downloadCsv('finance-top-services.csv', ['Service', 'Appointment count', 'Sales (PHP)'], report.top_services.map((row) => [row.service, row.count, peso(row.amount)]));
    if (section === 'expense-categories') downloadCsv('finance-expenses-by-category.csv', ['Category', 'Expenses (PHP)'], report.expenses_by_category.map((row) => [row.category, peso(row.amount)]));
  }

  refs.reportFrom.value = state.from;
  refs.reportTo.value = state.to;
  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.period === 'custom') {
      document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('is-active', item === button));
      return;
    }
    setPeriod(button.dataset.period);
  }));
  [refs.reportFrom, refs.reportTo].forEach((input) => input.addEventListener('change', () => {
    state.from = refs.reportFrom.value; state.to = refs.reportTo.value;
    document.querySelectorAll('[data-period]').forEach((button) => button.classList.toggle('is-active', button.dataset.period === 'custom'));
    if (state.from && state.to) load().catch((error) => { refs.reportMessage.textContent = error.message; });
  }));
  document.getElementById('printReport').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => exportSection(button.dataset.export)));
  load().catch((error) => { refs.reportMessage.textContent = error.message; });
})();