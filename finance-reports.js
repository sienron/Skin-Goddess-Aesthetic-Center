(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const refs = Object.fromEntries(['reportPeriodLabel', 'reportFrom', 'reportTo', 'reportMessage', 'reportSales', 'reportCollected', 'reportExpenses', 'reportNet', 'reportSalesComparison', 'reportCollectedComparison', 'reportExpensesComparison', 'reportNetComparison', 'reportDepositsReceived', 'reportDepositsReceivedCount', 'reportRefunds', 'reportRefundsCount', 'reportForfeited', 'reportForfeitedCount', 'dailyCashRows', 'dailyCashEmpty', 'dailyCashPagination', 'dailyCashPrev', 'dailyCashNext', 'dailyCashPageLabel'].map((id) => [id, document.getElementById(id)]));
  const state = { from: common.monthStart(), to: common.manilaToday(), data: null, monthly: [], methods: [] };
  const dailyCashPageSize = 8;
  let dailyCashPage = 0;
  const colors = ['#C9A84C', '#228B46', '#4388E8', '#929292', '#8a6e2f', '#B93C3C'];
  const exportButtons = Array.from(document.querySelectorAll('[data-export]'));
  let reportRequest = 0;

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

  function downloadCsv(name, headers, rows, section) {
    const report = state.data;
    const metadata = [
      ['Report section', section],
      ['Generated at (Asia/Manila)', report.generated_at],
      ['Selected date range', `${state.from} to ${state.to}`],
      ['Date basis', report.date_basis],
      ['Calculation basis', report.accounting_basis],
      ['Active filters', 'None beyond selected date range'],
      [],
      headers,
    ];
    const csv = [...metadata, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = name;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function peso(value) { return common.formatPeso(value); }

  function renderDailyCash() {
    const rows = state.data.daily_cash;
    const pageCount = Math.max(1, Math.ceil(rows.length / dailyCashPageSize));
    dailyCashPage = Math.min(dailyCashPage, pageCount - 1);
    refs.dailyCashRows.replaceChildren();
    rows.slice(dailyCashPage * dailyCashPageSize, (dailyCashPage + 1) * dailyCashPageSize).forEach((row) => {
      const tr = document.createElement('tr');
      addCell(tr, row.date);
      addCell(tr, peso(row.collected));
      addCell(tr, peso(row.expenses));
      addCell(tr, peso(Number(row.collected) - Number(row.expenses)));
      refs.dailyCashRows.append(tr);
    });
    refs.dailyCashEmpty.hidden = rows.length > 0;
    refs.dailyCashPagination.hidden = rows.length <= dailyCashPageSize;
    refs.dailyCashPrev.disabled = dailyCashPage === 0;
    refs.dailyCashNext.disabled = dailyCashPage >= pageCount - 1;
    refs.dailyCashPageLabel.textContent = `Page ${dailyCashPage + 1} of ${pageCount}`;
  }

  function renderReportChart(canvasId, config) {
    const hasData = config.data.datasets.some((dataset) =>
      (dataset.data || []).some((value) => Number.isFinite(Number(value)) && Number(value) !== 0)
    );
    const panel = document.getElementById(canvasId).closest('.fin-report-panel');
    panel.classList.toggle('is-empty', !hasData);
    return common.renderChart(canvasId, config);
  }

  async function load() {
    const requestId = ++reportRequest;
    const previous = common.previousRange(state.from, state.to);
    state.data = null;
    exportButtons.forEach((button) => { button.disabled = true; });
    refs.reportMessage.textContent = '';
    refs.reportPeriodLabel.textContent = `${state.from} to ${state.to}`;
    const monthCount = (Number(state.to.slice(0, 4)) - Number(state.from.slice(0, 4))) * 12 + Number(state.to.slice(5, 7)) - Number(state.from.slice(5, 7)) + 1;
    const range = common.rangeParams(state.from, state.to);
    const [report, previousReport, monthly, methods] = await Promise.all([
      common.fetchJson(`/api/finance/report?${range}`),
      common.fetchJson(`/api/finance/report?${common.rangeParams(previous.from, previous.to)}`),
      common.fetchJson(`/api/finance/monthly?${common.rangeParams(state.from, state.to, { months: Math.min(Math.max(monthCount, 1), 24) })}`),
      common.fetchJson(`/api/finance/by-method?${range}`),
    ]);
    if (requestId !== reportRequest) return;
    state.data = report;
    state.monthly = monthly;
    state.methods = methods;
    exportButtons.forEach((button) => { button.disabled = false; });
    const income = report.income_statement;
    refs.reportSales.textContent = peso(income.sales);
    refs.reportCollected.textContent = peso(income.collected);
    refs.reportExpenses.textContent = peso(income.expenses);
    refs.reportNet.textContent = peso(income.net_income);
    const previousIncome = previousReport.income_statement;
    refs.reportSalesComparison.textContent = `${common.formatComparison(income.sales, previousIncome.sales)} · previous ${previous.from} to ${previous.to}`;
    refs.reportCollectedComparison.textContent = `${common.formatComparison(income.collected, previousIncome.collected)} · previous ${previous.from} to ${previous.to}`;
    refs.reportExpensesComparison.textContent = `${common.formatComparison(income.expenses, previousIncome.expenses)} · previous ${previous.from} to ${previous.to}`;
    refs.reportNetComparison.textContent = `${common.formatComparison(income.net_income, previousIncome.net_income)} · previous ${previous.from} to ${previous.to}`;

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

    renderReportChart('reportSalesExpensesChart', {
      type: 'bar', data: { labels: monthly.map((row) => row.month), datasets: [{ label: 'Sales earned', data: monthly.map((row) => Number(row.sales)), backgroundColor: '#C9A84C' }, { label: 'Recorded expenses', data: monthly.map((row) => Number(row.expenses)), backgroundColor: '#B93C3C' }] },
      options: { plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${peso(item.raw)}` } } } },
    });
    renderReportChart('reportOnlineReservationsChart', {
      type: 'line', data: { labels: report.online_reservations.map((row) => row.date), datasets: [{ label: 'Online reservations', data: report.online_reservations.map((row) => Number(row.count)), borderColor: '#228B46', backgroundColor: 'rgba(34,139,70,.12)', fill: true, tension: 0.22, pointRadius: 2 }] },
      options: { scales: { y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => `${item.raw} online reservation${Number(item.raw) === 1 ? '' : 's'}` } } } },
    });
    renderReportChart('reportServiceCategoryChart', {
      type: 'pie', data: { labels: report.service_categories.map((row) => row.category), datasets: [{ data: report.service_categories.map((row) => Number(row.amount)), backgroundColor: colors, borderWidth: 1, borderColor: '#fff' }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${peso(item.raw)}` } } } },
    });
    renderReportChart('reportDepositsChart', {
      type: 'doughnut', data: { labels: report.deposits.map((row) => row.status), datasets: [{ data: report.deposits.map((row) => Number(row.amount)), backgroundColor: ['#228B46', '#B93C3C', '#929292'], borderColor: '#fff', borderWidth: 1 }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${peso(item.raw)}` } } } },
    });
    renderReportChart('reportMethodsChart', {
      type: 'bar', data: { labels: methods.map((row) => common.paymentMethodLabel(row.method)), datasets: [{ label: 'Collected', data: methods.map((row) => Number(row.amount)), backgroundColor: '#C9A84C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });
    renderReportChart('reportTopServicesChart', {
      type: 'bar', data: { labels: report.top_services.map((row) => row.service), datasets: [{ label: 'Sales earned', data: report.top_services.map((row) => Number(row.amount)), backgroundColor: '#C9A84C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });
    renderReportChart('reportExpenseCategoryChart', {
      type: 'bar', data: { labels: report.expenses_by_category.map((row) => row.category), datasets: [{ label: 'Expenses', data: report.expenses_by_category.map((row) => Number(row.amount)), backgroundColor: '#B93C3C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => peso(item.raw) } } } },
    });

    dailyCashPage = 0;
    renderDailyCash();
  }

  async function exportSection(section) {
    if (!state.data) return;
    const report = state.data;
    if (section === 'income-statement') {
      const charts = [
        ['Sales earned vs expenses', 'reportSalesExpensesChart'],
        ['Online reservations', 'reportOnlineReservationsChart'],
        ['Revenue by service category', 'reportServiceCategoryChart'],
        ['Deposits by status', 'reportDepositsChart'],
        ['Cash collected by payment method', 'reportMethodsChart'],
        ['Top services', 'reportTopServicesChart'],
        ['Expenses by category', 'reportExpenseCategoryChart'],
      ].reduce((images, [title, id]) => {
        const canvas = document.getElementById(id);
        if (canvas && !canvas.hidden && canvas.width && canvas.height) {
          images[title] = canvas.toDataURL('image/png');
        }
        return images;
      }, {});
      refs.reportMessage.textContent = 'Preparing Excel workbook with charts…';
      const exportButton = exportButtons.find((button) => button.dataset.export === section);
      if (exportButton) exportButton.disabled = true;
      try {
        let response;
        try {
          response = await fetch('/api/finance/export-report.xlsx', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: state.from, to: state.to, charts }),
          });
        } catch {
          throw new Error('Unable to reach the server. Check your connection and try again.');
        }
        if (!response.ok) {
          const body = await response.text();
          let message = `Request failed (${response.status}).`;
          try {
            message = JSON.parse(body).message || message;
          } catch {
            if (body) message = body;
          }
          throw new Error(message);
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `finance-income-statement-${state.from}-to-${state.to}.xlsx`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        refs.reportMessage.textContent = 'Excel workbook exported.';
      } finally {
        if (exportButton) exportButton.disabled = false;
      }
      return;
    }
    if (section === 'daily-cash') {
      window.location.href = `/api/finance/export.csv?${common.rangeParams(state.from, state.to, { section })}`;
      return;
    }
    if (section === 'payment-methods') downloadCsv('finance-payment-methods.csv', ['Method', 'Payment count', 'Cash collected (PHP)'], state.methods.map((row) => [common.paymentMethodLabel(row.method), row.count, peso(row.amount)]), section);
    if (section === 'online-reservations') downloadCsv('finance-online-reservations.csv', ['Payment date', 'Online reservations'], report.online_reservations.map((row) => [row.date, row.count]), section);
    if (section === 'sales-expenses') downloadCsv('finance-sales-vs-expenses.csv', ['Month', 'Sales earned (PHP)', 'Recorded expenses (PHP)'], state.monthly.map((row) => [row.month, peso(row.sales), peso(row.expenses)]), section);
    if (section === 'collections') downloadCsv('finance-collections-trend.csv', ['Date', 'Cash collected (PHP)'], report.daily_cash.map((row) => [row.date, peso(row.collected)]), section);
    if (section === 'service-categories') downloadCsv('finance-service-categories.csv', ['Category', 'Sales earned (PHP)'], report.service_categories.map((row) => [row.category, peso(row.amount)]), section);
    if (section === 'deposits') downloadCsv('finance-deposit-summary.csv', ['Status', 'Count', 'Amount (PHP)'], report.deposits.map((row) => [row.status, row.count, peso(row.amount)]), section);
    if (section === 'top-services') downloadCsv('finance-top-services.csv', ['Service', 'Appointment count', 'Sales earned (PHP)'], report.top_services.map((row) => [row.service, row.count, peso(row.amount)]), section);
    if (section === 'expense-categories') downloadCsv('finance-expenses-by-category.csv', ['Category', 'Expenses (PHP)'], report.expenses_by_category.map((row) => [row.category, peso(row.amount)]), section);
  }

  refs.reportFrom.value = state.from;
  refs.reportTo.value = state.to;
  common.bindPeriodControls({
    fromInput: refs.reportFrom,
    toInput: refs.reportTo,
    buttons: document.querySelectorAll('[data-period]'),
    onChange: (range) => {
      state.from = range.from;
      state.to = range.to;
      load().catch((error) => { refs.reportMessage.textContent = error.message; });
    },
    onInvalid: (error) => { refs.reportMessage.textContent = error; },
  });
  exportButtons.forEach((button) => button.addEventListener('click', () => {
    exportSection(button.dataset.export).catch((error) => { refs.reportMessage.textContent = error.message; });
  }));
  refs.dailyCashPrev.addEventListener('click', () => {
    if (dailyCashPage > 0) {
      dailyCashPage -= 1;
      renderDailyCash();
    }
  });
  refs.dailyCashNext.addEventListener('click', () => {
    if (state.data && (dailyCashPage + 1) * dailyCashPageSize < state.data.daily_cash.length) {
      dailyCashPage += 1;
      renderDailyCash();
    }
  });
  load().catch((error) => { refs.reportMessage.textContent = error.message; });
})();