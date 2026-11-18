(() => {
  const common = window.FinanceCommon;
  if (!common) return;

  const buttons = Array.from(document.querySelectorAll('[data-chart-export]'));
  const message = document.getElementById('reportMessage');
  const colors = ['#C9A84C', '#2E7D5B', '#3B6FD4', '#C0392B', '#7B4FB5', '#E07B24', '#17A2B8', '#6B7280', '#D6458A', '#4C8C2B'];
  const labelColors = {
    'Fully Paid': '#2E7D5B', 'Partially Paid': '#E07B24', Unpaid: '#C0392B',
    'Walk-in': '#3B6FD4', Online: '#7B4FB5', Unknown: '#6B7280',
  };
  const pick = (rows) => rows.map((row, index) => labelColors[row.label] || colors[index % colors.length]);
  // Frontend-only preview shown when no product sales exist; never exported or stored.
  const demoAfterSales = [
    { label: 'Sunscreen SPF 50', value: 18 }, { label: 'Facial Cleanser', value: 14 },
    { label: 'Moisturizer', value: 11 }, { label: 'Hydrating Toner', value: 9 },
    { label: 'Vitamin C Serum', value: 7 }, { label: 'Niacinamide Serum', value: 5 },
  ];
  const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`)
    .toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const chartIds = ['reportRevenueChart', 'reportSourceChart', 'reportStatusChart', 'reportMethodsChart', 'reportAfterSalesChart', 'reportInventoryChart', 'reportUtilitiesChart'];  let requestId = 0;
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
      config.showZeroValues = config.showZeroValues ?? true;
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
        { label: 'Collected', data: report.revenue_by_service.map((row) => row.value), backgroundColor: pick(report.revenue_by_service), borderRadius: 3 },
      ] }, options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: moneyTooltip } },
    });
    renderChart('reportSourceChart', {
      type: 'pie', data: { labels: report.appointment_source.map((row) => row.label), datasets: [
        { data: report.appointment_source.map((row) => row.value), backgroundColor: pick(report.appointment_source), borderWidth: 2 },
      ] }, options: { layout: { padding: 8 }, plugins: { legend: { position: 'bottom' } } },
    });
    renderChart('reportStatusChart', {
      type: 'doughnut', data: { labels: report.payment_status.map((row) => row.label), datasets: [
        { data: report.payment_status.map((row) => row.value), backgroundColor: pick(report.payment_status), borderWidth: 2 },
      ] }, options: { layout: { padding: 8 }, plugins: { legend: { position: 'bottom' } } },
    });
    renderChart('reportMethodsChart', {
      type: 'bar', data: { labels: report.payment_methods.map((row) => common.paymentMethodLabel(row.label)), datasets: [
        { label: 'Transactions', data: report.payment_methods.map((row) => row.value), backgroundColor: pick(report.payment_methods), borderRadius: 3 },
      ] }, options: { scales: { y: { beginAtZero: true, ticks: { precision: 0, color: textColor } } }, plugins: { legend: { display: false } } },
    });
    const afterSales = report.after_sales_products || [];
    const demoSales = afterSales.length === 0;
    const salesRows = demoSales ? demoAfterSales : afterSales;
    document.getElementById('afterSalesSubtitle').textContent = demoSales
      ? 'Demo data: no product sales recorded for this period.'
      : 'Units sold per product from recorded product sales.';
    buttons.forEach((button) => {
      if (button.dataset.chartExport === 'after-sales-products') button.disabled = demoSales;
    });
    renderChart('reportAfterSalesChart', {
      type: 'bar', data: { labels: salesRows.map((row) => row.label), datasets: [
        { label: 'Units sold', data: salesRows.map((row) => row.value), backgroundColor: pick(salesRows), borderRadius: 3 },
      ] }, options: { scales: { y: { beginAtZero: true, ticks: { precision: 0, color: textColor } } }, plugins: { legend: { display: false } } },
    });
    const consumption = report.inventory_consumption || [];
    renderChart('reportInventoryChart', {
      type: 'bar', data: { labels: consumption.map((row) => row.label), datasets: [
        { label: 'Units consumed', data: consumption.map((row) => row.value), backgroundColor: pick(consumption), borderRadius: 3 },
      ] }, options: { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0, color: textColor } } }, plugins: { legend: { display: false } } },
    });
    const utilities = report.utilities_trend || { labels: [], current: [], previous_year: [] };
    renderChart('reportUtilitiesChart', {
      type: 'line', showZeroValues: false, data: { labels: utilities.labels.map(monthLabel), datasets: [
        { label: 'This period', data: utilities.current, borderColor: '#C9A84C', backgroundColor: '#C9A84C', tension: 0.25, pointRadius: 3 },
        { label: 'Same month last year', data: utilities.previous_year, borderColor: '#3B6FD4', backgroundColor: '#3B6FD4', borderDash: [6, 4], tension: 0.25, pointRadius: 3 },
      ] }, options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: moneyTooltip } },
    });  }

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
      buttons.forEach((button) => {
        button.disabled = button.dataset.chartExport === 'after-sales-products' && !(report.after_sales_products || []).length;
      });
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
