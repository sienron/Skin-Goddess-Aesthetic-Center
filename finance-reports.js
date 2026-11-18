(() => {
  const common = window.FinanceCommon;
  if (!common) return;

  const buttons = Array.from(document.querySelectorAll('[data-chart-export]'));
  const message = document.getElementById('reportMessage');
  const colors = ['#C9A84C', '#228B46', '#4388E8', '#929292', '#8a6e2f', '#B93C3C'];
  const chartIds = ['reportRevenueChart', 'reportSourceChart', 'reportStatusChart', 'reportMethodsChart'];
  let requestId = 0;
  let current = null;

  function invalidate(clear = false) {
    requestId += 1;
    current = null;
    buttons.forEach((button) => { button.disabled = true; });
    if (clear) showUnavailable('Choose a valid date range.');
  }

  function showUnavailable(text) {
    chartIds.forEach((id) => {
      common.renderChart(id, { type: 'bar', data: { labels: [], datasets: [] } });
      const empty = document.getElementById(id).closest('.fin-chart-frame').querySelector('.fin-chart-empty');
      if (empty) empty.textContent = text;
    });
  }

  function render() {
    if (!current) return;
    const { report } = current;
    const textColor = document.body.classList.contains('staff-theme-dark') ? '#e9e4da' : '#514b43';
    const peso = (value) => common.formatPeso(value);
    const renderChart = (id, config) => {
      config.showZeroValues = true;
      config.options = {
        ...config.options,
        color: textColor,
        plugins: {
          ...config.options?.plugins,
          legend: { labels: { color: textColor }, ...config.options?.plugins?.legend },
        },
        scales: config.type === 'bar' || config.type === 'line' ? {
          x: { ticks: { color: textColor } },
          y: { ticks: { color: textColor } },
          ...config.options?.scales,
        } : undefined,
      };
      common.renderChart(id, config);
    };
    const moneyTooltip = { callbacks: { label: (item) => `${item.dataset.label || item.label}: ${peso(item.raw)}` } };

    document.getElementById('reportRevenueChart').closest('.fin-chart-frame').style.height =
      `${Math.max(224, report.revenue_by_service.length * 30 + 60)}px`;
    renderChart('reportRevenueChart', {
      type: 'bar', data: { labels: report.revenue_by_service.map((row) => row.label), datasets: [
        { label: 'Collected', data: report.revenue_by_service.map((row) => row.value), backgroundColor: '#C9A84C', borderRadius: 3 },
      ] }, options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: moneyTooltip } },
    });
    renderChart('reportSourceChart', {
      type: 'pie', data: { labels: report.appointment_source.map((row) => row.label), datasets: [
        { data: report.appointment_source.map((row) => row.value), backgroundColor: colors, borderWidth: 1 },
      ] }, options: { plugins: { legend: { position: 'bottom' } } },
    });
    renderChart('reportStatusChart', {
      type: 'doughnut', data: { labels: report.payment_status.map((row) => row.label), datasets: [
        { data: report.payment_status.map((row) => row.value), backgroundColor: colors, borderWidth: 1 },
      ] }, options: { plugins: { legend: { position: 'bottom' } } },
    });
    renderChart('reportMethodsChart', {
      type: 'bar', data: { labels: report.payment_methods.map((row) => common.paymentMethodLabel(row.label)), datasets: [
        { label: 'Transactions', data: report.payment_methods.map((row) => row.value), backgroundColor: '#228B46', borderRadius: 3 },
      ] }, options: { scales: { y: { beginAtZero: true, ticks: { precision: 0, color: textColor } } }, plugins: { legend: { display: false } } },
    });
  }

  async function load({ from, to }) {
    invalidate();
    const sequence = requestId;
    message.textContent = 'Loading financial charts…';
    try {
      const range = common.rangeParams(from, to);
      const report = await common.fetchJson(`/api/finance/report?${range}&view=operational`);
      if (sequence !== requestId) return;
      if (!report || !['revenue_by_service', 'appointment_source', 'payment_status', 'payment_methods']
        .every((key) => Array.isArray(report[key]))) {
        throw new Error('The report service returned an unexpected response. Make sure the latest server is running and your session is active.');
      }
      current = { from, to, report };
      render();
      buttons.forEach((button) => { button.disabled = false; });
      message.textContent = '';
    } catch (error) {
      if (sequence !== requestId) return;
      current = null;
      showUnavailable('Unable to load chart data.');
      message.textContent = `Unable to load financial charts: ${error.message}`;
    }
  }

  buttons.forEach((button) => {
    button.disabled = true;
    button.addEventListener('click', () => {
      if (!current) return;
      const range = common.rangeParams(current.from, current.to);
      window.location.href = `/api/finance/export.xlsx?${range}&section=report-chart&chart=${encodeURIComponent(button.dataset.chartExport)}`;
    });
  });
  new MutationObserver(() => render()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.FinanceReports = { load, invalidate };
})();
