(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const state = {
    tab: 'transactions',
    from: common.monthStart(),
    to: common.manilaToday(),
    type: '',
    method: '',
    status: 'posted',
    receivableStatus: 'all',
    search: '',
    receivableSearch: '',
    sort: 'date',
    direction: 'desc',
    page: 1,
    receivablePage: 1,
    depositPage: 1,
    limit: 25,
    rows: [],
    total: 0,
    receivables: [],
    deposits: [],
    selectedClient: null,
    paymentRequestKeys: new Map(),
  };
  let transactionRequest = 0;
  const byId = (id) => document.getElementById(id);
  function createRequestKey() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const refs = Object.fromEntries(['transactionFrom', 'transactionTo', 'transactionType', 'transactionMethod', 'transactionStatus', 'transactionSearch', 'transactionMessage', 'transactionRows', 'transactionCount', 'transactionEmpty', 'transactionPagination', 'transactionPrev', 'transactionNext', 'transactionPageLabel', 'transactionPageSize', 'transactionPeriodLabel', 'transactionComparison', 'ledgerHelp', 'transactionSummary', 'transactionOverview', 'paymentCountSummary', 'paymentCountLabel', 'receivablesPanel', 'transactionsPanel', 'depositsPanel', 'methodChartSection', 'methodChartEmpty', 'receivableRows', 'receivableEmpty', 'receivableSearch', 'receivableStatus', 'receivablePagination', 'receivablePrev', 'receivableNext', 'receivablePageLabel', 'receivablePageSize', 'exportReceivablesXlsx', 'depositRows', 'depositEmpty', 'depositCount', 'depositPagination', 'depositPrev', 'depositNext', 'depositPageLabel', 'depositPageSize', 'recordPaymentModal', 'recordPaymentForm', 'balanceAppointmentId', 'balanceAmount', 'balanceMethod', 'balanceReference', 'balanceNote', 'paymentBalanceText', 'paymentFormMessage', 'saleModal', 'saleForm', 'saleClient', 'saleProduct', 'saleQuantity', 'salePrice', 'saleTotal', 'saleMethod', 'saleReference', 'saleMessage', 'saleSubmit', 'recordSaleBtn', 'exportTransactionsXlsx', 'refundModal', 'refundForm', 'refundPaymentId', 'refundPaymentSummary', 'refundNote', 'refundFormMessage', 'reverseModal', 'reverseForm', 'reversePaymentId', 'reversePaymentSummary', 'reverseReason', 'reverseFormMessage', 'paymentDetailsModal', 'paymentDetails', 'paymentHistoryRows', 'paymentHistoryEmpty', 'receiptModal', 'receiptModalTitle', 'receiptFrame', 'clientDetailsModal', 'clientDetailsTitle', 'clientDetails', 'clientPaymentHistoryBtn', 'clientPaymentHistoryModal', 'clientPaymentHistoryTitle', 'clientPaymentHistoryMessage', 'clientPaymentHistoryRows', 'clientPaymentHistoryEmpty'].map((id) => [id, byId(id)]));
  const chartColors = ['#c9a84c', '#267447', '#3977b8', '#8c8c8c', '#8a6e2f'];
  refs.recordSaleBtn.classList.add('fin-sales-record-button');
  refs.methodChartLegend = element('ul', '', 'fin-chart-legend');
  refs.methodChartLegend.setAttribute('aria-label', 'Payment methods, amounts, and share of posted collections');
  const methodChartFrame = byId('methodChart').closest('.fin-chart-frame');
  refs.exportTransactionsXlsx.disabled = true;
  refs.methodChartLoading = element('div', 'Updating chart…', 'fin-chart-loading');
  refs.methodChartLoading.hidden = true;
  refs.methodChartLoading.setAttribute('role', 'status');
  refs.methodChartLoading.setAttribute('aria-live', 'polite');
  methodChartFrame.append(refs.methodChartLoading);
  methodChartFrame.after(refs.methodChartLegend);
  let saleRequestKey = null;
  let saleModalRequest = 0;
  let saleProducts = [];
  const temporarySkincareProducts = [
    'Facial Cleanser',
    'Hydrating Toner',
    'Vitamin C Serum',
    'Niacinamide Serum',
    'Moisturizer',
    'Sunscreen SPF 50',
  ];

  function element(tag, text = '', className = '') {
    const item = document.createElement(tag);
    item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function cell(row, value) { row.append(element('td', value == null || value === '' ? '-' : String(value))); }
  function message(text, error = false) {
    refs.transactionMessage.textContent = text;
    refs.transactionMessage.style.color = error ? '#b93c3c' : '#4388e8';
  }
  function modalOpen(modal) { common.openAccessibleModal(modal); }
  function modalClose(modal) { common.closeAccessibleModal(modal); }
  function params(extra = {}) { return common.rangeParams(state.from, state.to, extra); }

  function updatePagination(container, previous, next, label, total, page) {
    const pageCount = Math.max(1, Math.ceil(total / state.limit));
    container.hidden = total === 0;
    label.textContent = `Page ${page} of ${pageCount}`;
    previous.disabled = page <= 1;
    next.disabled = page >= pageCount;
  }

  function renderTransactions() {
    refs.transactionRows.replaceChildren();
    state.rows.forEach((payment) => {
      const row = element('tr');
      row.tabIndex = 0;
      if (payment.status === 'outstanding') row.dataset.appointmentId = payment.appointment_id;
      else row.dataset.paymentId = payment.payment_id;
      cell(row, payment.payment_date);
      cell(row, payment.receipt_number || '-');
      const clientCell = element('td');
      if (payment.customer_id) {
        const clientButton = element('button', payment.client, 'fin-client-link');
        clientButton.type = 'button';
        clientButton.dataset.clientId = payment.customer_id;
        clientButton.dataset.clientName = payment.client;
        clientButton.dataset.clientEmail = payment.customer_email || '';
        clientCell.append(clientButton);
      } else clientCell.textContent = payment.client;
      row.append(clientCell);
      cell(row, payment.payment_type.replace('_', ' '));
      cell(row, payment.service || payment.reference_no || '-');
      cell(row, common.paymentMethodLabel(payment.method));
      cell(row, common.formatPeso(payment.amount));
      const status = element('td');
      status.append(common.statusBadge(payment.status));
      row.append(status);
      const action = element('td');
      const actionButtons = element('div', '', 'fin-row-actions');
      if (payment.status === 'outstanding') {
        const recordButton = element('button', 'Record payment', 'fin-button fin-button-primary');
        recordButton.type = 'button';
        recordButton.dataset.outstandingAppointmentId = payment.appointment_id;
        actionButtons.append(recordButton);
      } else {
        const receiptButton = element('button', payment.status === 'posted' ? 'Receipt' : 'Adjustment notice', 'fin-button');
        receiptButton.type = 'button';
        receiptButton.dataset.receiptId = payment.payment_id;
        receiptButton.dataset.receiptTitle = payment.status === 'posted' ? 'Payment receipt' : 'Payment adjustment notice';
        actionButtons.append(receiptButton);
      }
      if (payment.status === 'posted') {
        const reverseButton = element('button', 'Reverse', 'fin-button fin-button-danger');
        reverseButton.type = 'button';
        reverseButton.dataset.reverseId = payment.payment_id;
        actionButtons.append(reverseButton);
      }
      action.append(actionButtons);
      row.append(action);
      refs.transactionRows.append(row);
    });
    refs.transactionEmpty.hidden = state.rows.length > 0;
    const paymentCount = state.total.toLocaleString('en-PH');
    const itemLabel = state.status === 'outstanding' ? 'service' : 'payment';
    refs.transactionCount.textContent = `${paymentCount} ${state.total === 1 ? itemLabel : `${itemLabel}s`}`;
    refs.transactionPageSize.value = String(state.limit);
    updatePagination(refs.transactionPagination, refs.transactionPrev, refs.transactionNext, refs.transactionPageLabel, state.total, state.page);
    refs.exportTransactionsXlsx.disabled = state.total <= 0;
  }

  async function loadTransactions() {
    const requestId = ++transactionRequest;
    const previous = common.previousRange(state.from, state.to);
    const filters = { page: state.page, limit: state.limit, type: state.type, method: state.method, status: state.status, q: state.search, sort: state.sort, direction: state.direction };
    const previousFilters = { type: state.type, method: state.method, q: state.search };
    refs.transactionPeriodLabel.textContent = `${state.from} to ${state.to}`;
    refs.paymentCountLabel.textContent = state.status === 'outstanding' ? 'Outstanding services' : 'Matching payments';
    refs.paymentCountSummary.textContent = 'Loading…';
    refs.transactionComparison.textContent = '';
    refs.transactionEmpty.querySelector('strong').textContent = state.status === 'outstanding'
      ? 'No outstanding services'
      : 'No matching payments';
    refs.transactionEmpty.querySelector('p').textContent = state.status === 'outstanding'
      ? 'No service balances are outstanding for the selected dates and filters.'
      : 'Try adjusting the dates or filters, or record a payment to get started.';
    refs.methodChartEmpty.querySelector('strong').textContent = 'No collections in this period';
    refs.methodChartEmpty.querySelector('span:last-child').textContent = 'Payment method totals will appear here.';
    refs.methodChartLegend.replaceChildren();
    refs.methodChartEmpty.hidden = true;
    refs.exportTransactionsXlsx.disabled = true;
    refs.methodChartLoading.hidden = false;
    refs.methodChartSection.setAttribute('aria-busy', 'true');
    refs.transactionSummary.setAttribute('aria-busy', 'true');
    refs.transactionsPanel.setAttribute('aria-busy', 'true');
    try {
      const [result, chartRows, previousChartRows] = await Promise.all([
        common.fetchJson(`/api/finance/transactions?${params(filters)}`),
        common.fetchJson(`/api/finance/by-method?${params({ type: state.type, method: state.method, q: state.search })}`),
        common.fetchJson(`/api/finance/by-method?${common.rangeParams(previous.from, previous.to, previousFilters)}`),
      ]);
      if (requestId !== transactionRequest) return;
      state.rows = result.rows;
      state.total = result.total;
      renderTransactions();
      const collected = chartRows.reduce((sum, row) => sum + Number(row.amount), 0);
      const previousCollected = previousChartRows.reduce((sum, row) => sum + Number(row.amount), 0);
      methodChartFrame.classList.toggle('is-empty', collected <= 0);
      refs.methodChartEmpty.hidden = collected > 0;
      refs.paymentCountSummary.textContent = Number(result.total).toLocaleString('en-PH');
      refs.transactionComparison.textContent = `Posted collections: ${common.formatComparison(collected, previousCollected)} · previous ${previous.from} to ${previous.to}`;
      refs.methodChartLegend.replaceChildren();
      if (collected > 0) {
        chartRows.forEach((row, index) => {
          const item = element('li');
          const swatch = element('span', '', 'fin-chart-legend-swatch');
          swatch.style.backgroundColor = chartColors[index % chartColors.length];
          swatch.setAttribute('aria-hidden', 'true');
          const method = element('span', common.paymentMethodLabel(row.method), 'fin-chart-legend-method');
          const amount = element('strong', common.formatPeso(row.amount), 'fin-chart-legend-amount');
          const share = element('span', `${(Number(row.amount) / collected * 100).toFixed(1)}%`, 'fin-chart-legend-share');
          item.append(swatch, method, amount, share);
          refs.methodChartLegend.append(item);
        });
      }
      common.renderChart('methodChart', {
        type: 'doughnut',
        data: { labels: chartRows.map((row) => common.paymentMethodLabel(row.method)), datasets: [{ data: chartRows.map((row) => Number(row.amount)), backgroundColor: chartColors, borderWidth: 2, borderColor: '#fff', hoverOffset: 4 }] },
        options: {
          cutout: '70%',
          radius: '92%',
          layout: { padding: 8 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (item) => `${item.label}: ${common.formatPeso(item.raw)}` } },
          },
        },
      });
    } catch (error) {
      if (requestId === transactionRequest) {
        refs.transactionEmpty.querySelector('strong').textContent = state.status === 'outstanding'
          ? 'Outstanding services could not be loaded'
          : 'Payments could not be loaded';
        refs.transactionEmpty.querySelector('p').textContent = 'Please try again when the connection is restored.';
        state.rows = [];
        state.total = 0;
        renderTransactions();
        refs.paymentCountSummary.textContent = '—';
        refs.transactionComparison.textContent = 'Posted collections could not be loaded.';
        refs.methodChartLegend.replaceChildren();
        methodChartFrame.classList.add('is-empty');
        refs.methodChartEmpty.hidden = false;
        refs.methodChartEmpty.querySelector('strong').textContent = 'Payment summary unavailable';
        refs.methodChartEmpty.querySelector('span:last-child').textContent = 'Payment method totals could not be loaded.';
        common.renderChart('methodChart', { type: 'doughnut', data: { labels: [], datasets: [{ data: [] }] } });
      }
      throw error;
    } finally {
      if (requestId === transactionRequest) {
        refs.methodChartLoading.hidden = true;
        refs.methodChartSection.removeAttribute('aria-busy');
        refs.transactionSummary.removeAttribute('aria-busy');
        refs.transactionsPanel.removeAttribute('aria-busy');
      }
    }
  }

  function createSaleRequestKey() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function renderSaleProductOptions(products) {
    const placeholder = new Option('Choose product', '');
    const examples = document.createElement('optgroup');
    examples.label = 'Temporary examples — frontend only (not selectable)';
    temporarySkincareProducts.forEach((name, index) => {
      const option = new Option(`${name} — preview only`, `temporary-${index + 1}`);
      option.disabled = true;
      examples.appendChild(option);
    });

    const inventory = document.createElement('optgroup');
    inventory.label = 'Inventory products (recordable when in stock)';
    if (!products.length) {
      const unavailable = new Option('No inventory products found', '');
      unavailable.disabled = true;
      inventory.appendChild(unavailable);
    } else {
      products.forEach((product) => {
        const stock = Number(product.stock_quantity);
        const option = new Option(
          `${product.product_name} — ${stock > 0 ? `${stock} in stock` : 'Out of stock'}`,
          product.product_id,
        );
        option.disabled = stock <= 0;
        inventory.appendChild(option);
      });
    }

    refs.saleProduct.replaceChildren(placeholder, examples, inventory);
  }

  async function openSaleModal() {
    const requestId = ++saleModalRequest;
    refs.saleForm.reset();
    refs.saleQuantity.value = '1';
    refs.saleQuantity.removeAttribute('max');
    refs.saleProduct.replaceChildren(new Option('Loading inventory products…', ''));
    refs.saleProduct.disabled = true;
    refs.saleClient.replaceChildren(new Option('Loading clients…', ''));
    refs.saleClient.disabled = true;
    refs.saleMessage.textContent = '';
    saleProducts = [];
    saleRequestKey = createSaleRequestKey();
    refs.saleSubmit.disabled = true;
    modalOpen(refs.saleModal);
    let clientNotice = '';
    let productNotice = '';
    const updateSaleMessage = () => {
      refs.saleMessage.textContent = [clientNotice, productNotice].filter(Boolean).join(' ');
    };
    common.fetchJson('/api/finance/clients').then((clients) => {
      if (requestId !== saleModalRequest) return;
      if (!Array.isArray(clients)) throw new Error('The client list response was not a list.');
      refs.saleClient.replaceChildren(new Option(
        clients.length ? 'No client selected' : 'No active clients found',
        '',
      ));
      clients.forEach((client) => {
        const label = client.name || client.email;
        refs.saleClient.add(new Option(`${label} (${client.email})`, String(client.user_id)));
      });
      refs.saleClient.disabled = false;
      clientNotice = clients.length ? '' : 'No active clients were found; client selection is optional.';
      updateSaleMessage();
    }).catch((error) => {
      if (requestId !== saleModalRequest) return;
      refs.saleClient.replaceChildren(new Option('Client list unavailable', ''));
      refs.saleClient.disabled = true;
      clientNotice = `Client list could not be loaded: ${error.message}`;
      updateSaleMessage();
    });

    let products;
    try {
      products = await common.fetchJson('/api/finance/sale-products');
      if (requestId !== saleModalRequest) return;
      if (!Array.isArray(products)) throw new Error('The inventory product response was not a list.');
    } catch (error) {
      if (requestId !== saleModalRequest) return;
      renderSaleProductOptions([]);
      refs.saleProduct.options[0].textContent = 'Inventory products unavailable';
      refs.saleProduct.disabled = true;
      refs.saleSubmit.disabled = true;
      productNotice = `Inventory products could not be loaded: ${error.message}`;
      updateSaleMessage();
      return;
    }

    saleProducts = products;
    renderSaleProductOptions(saleProducts);
    if (!saleProducts.length) {
      refs.saleProduct.disabled = false;
      refs.saleSubmit.disabled = true;
      productNotice = 'No inventory products are available. Temporary skincare examples cannot be recorded.';
      updateSaleMessage();
      return;
    }

    const hasStock = saleProducts.some((product) => Number(product.stock_quantity) > 0);
    refs.saleProduct.disabled = false;
    refs.saleSubmit.disabled = !hasStock;
    productNotice = hasStock
      ? ''
      : 'No inventory products are in stock. Temporary skincare examples cannot be recorded.';
    updateSaleMessage();
  }

  function updateSaleTotal() {
    const total = Number(refs.salePrice.value) * Number(refs.saleQuantity.value);
    refs.saleTotal.textContent = common.formatPeso(Number.isFinite(total) ? total : 0);
    const selectedProduct = saleProducts.find((product) => Number(product.product_id) === Number(refs.saleProduct.value));
    if (selectedProduct) refs.saleQuantity.max = selectedProduct.stock_quantity;
  }

  function exportTransactions() {
    state.search = refs.transactionSearch.value.trim();
    const query = params({
      section: 'transactions',
      type: state.type,
      method: state.method,
      status: state.status,
      q: state.search,
    });
    window.location.assign(`/api/finance/export.xlsx?${query}`);
  }

  function exportReceivables() {
    state.receivableSearch = refs.receivableSearch.value.trim();
    const query = params({
      section: 'receivables',
      q: state.receivableSearch,
      status: state.receivableStatus,
    });
    window.location.assign(`/api/finance/export.xlsx?${query}`);
  }

  async function loadReceivables() {
    state.receivables = await common.fetchJson(`/api/finance/receivables?${params({ q: state.receivableSearch, status: state.receivableStatus })}`);
    renderReceivables();
  }

  function renderReceivables() {
    const total = state.receivables.length;
    const pagination = common.paginateRows(state.receivables, state.receivablePage, state.limit);
    state.receivablePage = pagination.page;
    refs.receivableRows.replaceChildren();
    pagination.rows.forEach((item) => {
      const row = element('tr');
      row.tabIndex = 0;
      row.dataset.appointmentId = item.appointment_id;
      cell(row, item.appointment_date);
      cell(row, item.client);
      cell(row, item.service);
      const appointmentStatus = element('td');
      appointmentStatus.append(common.statusBadge(item.appointment_status));
      row.append(appointmentStatus);
      cell(row, common.formatPeso(item.service_price));
      cell(row, common.formatPeso(item.amount_paid));
      cell(row, common.formatPeso(item.outstanding));
      const paymentStatus = element('td');
      paymentStatus.append(common.statusBadge(item.status));
      row.append(paymentStatus);
      const action = element('td');
      const button = element('button', 'Record payment', 'fin-button fin-button-primary');
      button.type = 'button'; button.dataset.appointmentId = item.appointment_id;
      action.append(button); row.append(action); refs.receivableRows.append(row);
    });
    refs.receivableEmpty.hidden = total > 0;
    refs.receivableStatus.value = state.receivableStatus;
    refs.receivablePageSize.value = String(state.limit);
    refs.exportReceivablesXlsx.disabled = total === 0;
    updatePagination(refs.receivablePagination, refs.receivablePrev, refs.receivableNext, refs.receivablePageLabel, total, state.receivablePage);
  }

  async function loadDeposits() {
    state.deposits = await common.fetchJson(`/api/finance/deposits?${params()}`);
    renderDeposits();
  }

  function renderDeposits() {
    const total = state.deposits.length;
    const pagination = common.paginateRows(state.deposits, state.depositPage, state.limit);
    state.depositPage = pagination.page;
    refs.depositRows.replaceChildren();
    pagination.rows.forEach((deposit) => {
      const row = element('tr'); row.dataset.paymentId = deposit.payment_id; row.tabIndex = 0;
      cell(row, deposit.payment_date); cell(row, deposit.client); cell(row, deposit.appointment_date); cell(row, common.formatPeso(deposit.amount)); cell(row, common.paymentMethodLabel(deposit.method));
      const status = element('td');
      status.append(common.statusBadge(deposit.deposit_status));
      row.append(status);
      const action = element('td');
      if (deposit.deposit_status === 'paid') {
        if (deposit.method === 'cash' && deposit.appointment_status === 'cancelled') {
          const button = element('button', 'Mark as refunded', 'fin-button fin-button-danger');
          button.type = 'button'; button.dataset.refundId = deposit.payment_id; action.append(button);
        } else if (deposit.method === 'cash') action.textContent = 'Only canceled deposits eligible';
        else action.textContent = 'PayMongo refund required first';
      } else action.textContent = '-';
      row.append(action); refs.depositRows.append(row);
    });
    refs.depositEmpty.hidden = total > 0;
    refs.depositCount.textContent = `${total.toLocaleString('en-PH')} deposits`;
    refs.depositPageSize.value = String(state.limit);
    updatePagination(refs.depositPagination, refs.depositPrev, refs.depositNext, refs.depositPageLabel, total, state.depositPage);
  }

  async function loadCurrentTab() {
    message('');
    byId('transactionAnalyticsRow').hidden = state.tab !== 'transactions';
    refs.transactionsPanel.hidden = state.tab !== 'transactions';
    refs.receivablesPanel.hidden = state.tab !== 'receivables';
    refs.depositsPanel.hidden = state.tab !== 'deposits';
    refs.methodChartSection.hidden = state.tab !== 'transactions';
    refs.transactionSummary.hidden = state.tab !== 'transactions';
    refs.transactionOverview.classList.toggle('is-ledger', state.tab === 'transactions');
    refs.ledgerHelp.hidden = state.tab !== 'transactions';
    if (state.tab === 'transactions') await loadTransactions();
    if (state.tab === 'receivables') await loadReceivables();
    if (state.tab === 'deposits') await loadDeposits();
  }

  function renderPaymentDetails(data) {
    refs.paymentDetails.replaceChildren();
    state.selectedClient = data.payment.customer_id
      ? {
        id: data.payment.customer_id,
        name: data.payment.client || 'Client',
        email: data.payment.email || '',
      }
      : null;
    const details = [
      ['Client', data.payment.client], ['Receipt number', data.payment.receipt_number],
      ['Service', data.payment.service || 'Product sale'],
      ['Appointment date', data.payment.appointment_date || '-'], ['Payment date', data.payment.payment_date],
      ['Amount', common.formatPeso(data.payment.amount)], ['Method', common.paymentMethodLabel(data.payment.method)],
      ['Type', data.payment.payment_type], ['Status', data.payment.status],
      ['Reference', data.payment.reference_no || '-'], ['Note', data.payment.note || '-'],
    ];
    if (data.payment.reversal_reason) {
      details.push(
        ['Reversal reason', data.payment.reversal_reason],
        ['Reversed by user', data.payment.reversed_by],
        ['Reversed at', data.payment.reversed_at],
      );
    }
    details.forEach(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = element('dt');
      const description = element('dd');
      if (label === 'Client') {
        term.className = 'fin-payment-client-heading';
        term.append(element('span', label));
        const historyButton = element('button', 'Payment History', 'fin-button fin-client-payment-history-inline');
        historyButton.type = 'button';
        historyButton.disabled = !state.selectedClient;
        if (!state.selectedClient) historyButton.title = 'Payment history is unavailable for this client.';
        historyButton.addEventListener('click', () => showClientPaymentHistory());
        term.append(historyButton);
      } else {
        term.textContent = label;
      }
      if (label === 'Status') description.append(common.statusBadge(value));
      else description.textContent = value == null ? '-' : String(value);
      wrapper.append(term, description); refs.paymentDetails.append(wrapper);
    });
    refs.paymentHistoryRows.replaceChildren();
    data.history.forEach((record) => {
      const row = element('tr'); cell(row, record.payment_date); cell(row, record.payment_type); cell(row, common.paymentMethodLabel(record.method)); cell(row, common.formatPeso(record.amount));
      const status = element('td'); status.append(common.statusBadge(record.status)); row.append(status); refs.paymentHistoryRows.append(row);
    });
    refs.paymentHistoryEmpty.hidden = data.history.length > 0;
    modalOpen(refs.paymentDetailsModal);
  }

  async function showPaymentDetails(paymentId) {
    renderPaymentDetails(await common.fetchJson(`/api/finance/payments/${encodeURIComponent(paymentId)}`));
  }

  async function showAppointmentDetails(appointmentId) {
    renderPaymentDetails(await common.fetchJson(`/api/finance/appointments/${encodeURIComponent(appointmentId)}`));
  }

  function showClientDetails(button) {
    state.selectedClient = {
      id: button.dataset.clientId,
      name: button.dataset.clientName,
      email: button.dataset.clientEmail,
    };
    refs.clientDetailsTitle.textContent = state.selectedClient.name || 'Client details';
    refs.clientDetails.replaceChildren();
    [['Client', state.selectedClient.name], ['Email', state.selectedClient.email || 'Not provided']].forEach(([label, value]) => {
      const wrapper = document.createElement('div');
      wrapper.append(element('dt', label), element('dd', value));
      refs.clientDetails.append(wrapper);
    });
    refs.clientPaymentHistoryBtn.disabled = false;
    modalOpen(refs.clientDetailsModal);
  }

  async function showClientPaymentHistory() {
    if (!state.selectedClient) return;
    refs.clientPaymentHistoryRows.replaceChildren();
    refs.clientPaymentHistoryEmpty.hidden = true;
    refs.clientPaymentHistoryTitle.textContent = `${state.selectedClient.name} · Payment history`;
    refs.clientPaymentHistoryMessage.textContent = 'Loading payment history…';
    modalOpen(refs.clientPaymentHistoryModal);
    try {
      const result = await common.fetchJson(`/api/finance/clients/${encodeURIComponent(state.selectedClient.id)}/payment-history`);
      refs.clientPaymentHistoryTitle.textContent = `${result.client.name || state.selectedClient.name} · Payment history`;
      result.rows.forEach((payment) => {
        const row = element('tr');
        cell(row, payment.payment_date);
        cell(row, payment.appointment_reference || '-');
        cell(row, payment.description || '-');
        cell(row, payment.payment_type.replace('_', ' '));
        cell(row, common.paymentMethodLabel(payment.method));
        cell(row, common.formatPeso(payment.amount));
        const status = element('td');
        status.append(common.statusBadge(payment.status));
        row.append(status);
        const reference = payment.reference_no || payment.receipt_number || 'No reference';
        cell(row, payment.payment_id ? `#${payment.payment_id} · ${reference}` : reference);
        refs.clientPaymentHistoryRows.append(row);
      });
      refs.clientPaymentHistoryEmpty.hidden = result.rows.length > 0;
      refs.clientPaymentHistoryMessage.textContent = result.rows.length
        ? `${result.rows.length} payment${result.rows.length === 1 ? '' : 's'} recorded.`
        : '';
    } catch (error) {
      refs.clientPaymentHistoryMessage.textContent = `Could not load payment history: ${error.message}`;
    }

    function openRecordPayment(record, fromLedger = false) {
      refs.balanceAppointmentId.value = record.appointment_id;
      const appointmentId = Number(record.appointment_id);
      if (!state.paymentRequestKeys.has(appointmentId)) {
        state.paymentRequestKeys.set(appointmentId, createRequestKey());
      }
      refs.balanceAmount.value = Number(record.outstanding).toFixed(2);
      refs.balanceAmount.max = Number(record.outstanding).toFixed(2);
      refs.balanceMethod.value = '';
      refs.balanceReference.value = '';
      refs.balanceNote.value = '';
      refs.paymentBalanceText.textContent = `${record.client} - ${record.service}: ${common.formatPeso(record.outstanding)} outstanding`;
      refs.paymentFormMessage.textContent = '';
      refs.recordPaymentForm.dataset.fromLedger = String(fromLedger);
      modalOpen(refs.recordPaymentModal);
    }
  }

  const transactionSortButtons = [...document.querySelectorAll('#transactionsPanel [data-sort-column]')];
  function updateTransactionSortIndicators() {
    transactionSortButtons.forEach((button) => {
      const active = button.dataset.sortColumn === state.sort;
      button.closest('th').setAttribute('aria-sort', active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      button.dataset.direction = active ? state.direction : '';
    });
  }
  updateTransactionSortIndicators();

  function setViewMenuExpanded(expanded) {
    const toggle = byId('transactionViewToggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} Sales & Transactions views`);
    }
    byId('transactionViewMenu').hidden = !expanded;
  }

  function setTab(tab) {
    state.tab = tab;
    state.page = 1;
    state.receivablePage = 1;
    state.depositPage = 1;
    setViewMenuExpanded(true);
    document.querySelectorAll('.fin-nav-view-tab').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    loadCurrentTab().catch((error) => message(error.message, true));
    const mobileNavOverlay = byId('mobileNavOverlay');
    if (mobileNavOverlay.classList.contains('show')) mobileNavOverlay.click();
  }

  refs.transactionFrom.value = state.from;
  refs.transactionTo.value = state.to;
  common.bindPeriodControls({
    fromInput: refs.transactionFrom,
    toInput: refs.transactionTo,
    buttons: document.querySelectorAll('[data-period]'),
    onChange: (range) => {
      state.from = range.from;
      state.to = range.to;
      state.page = 1;
      state.receivablePage = 1;
      state.depositPage = 1;
      loadCurrentTab().catch((error) => message(error.message, true));
    },
    onInvalid: (error) => message(error, true),
  });
  refs.transactionType.addEventListener('change', () => { state.type = refs.transactionType.value; state.page = 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionMethod.addEventListener('change', () => { state.method = refs.transactionMethod.value; state.page = 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionStatus.addEventListener('change', () => { state.status = refs.transactionStatus.value; state.page = 1; loadTransactions().catch((error) => message(error.message, true)); });
  transactionSortButtons.forEach((button) => button.addEventListener('click', () => {
    if (state.sort === button.dataset.sortColumn) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
    else {
      state.sort = button.dataset.sortColumn;
      state.direction = 'asc';
    }
    state.page = 1;
    updateTransactionSortIndicators();
    loadTransactions().catch((error) => message(error.message, true));
  }));
  let searchTimer;
  refs.transactionSearch.addEventListener('input', () => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = refs.transactionSearch.value.trim(); state.page = 1; loadTransactions().catch((error) => message(error.message, true)); }, 250);
  });
  let receivableSearchTimer;
  refs.receivableSearch.addEventListener('input', () => {
    clearTimeout(receivableSearchTimer);
    receivableSearchTimer = setTimeout(() => {
      state.receivableSearch = refs.receivableSearch.value.trim();
      state.receivablePage = 1;
      loadReceivables().catch((error) => message(error.message, true));
    }, 250);
  });
  refs.receivableStatus.addEventListener('change', () => {
    state.receivableStatus = refs.receivableStatus.value;
    state.receivablePage = 1;
    loadReceivables().catch((error) => message(error.message, true));
  });
  [refs.transactionPageSize, refs.receivablePageSize, refs.depositPageSize].forEach((select) => {
    select.addEventListener('change', () => {
      state.limit = Number(select.value);
      state.page = 1;
      state.receivablePage = 1;
      state.depositPage = 1;
      loadCurrentTab().catch((error) => message(error.message, true));
    });
  });
  byId('transactionViewToggle').addEventListener('click', () => {
    const expanded = byId('transactionViewToggle').getAttribute('aria-expanded') === 'true';
    setViewMenuExpanded(!expanded);
  });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('.fin-nav-view-tab[data-tab]');
    if (button) setTab(button.dataset.tab);
  });
  refs.transactionPrev.addEventListener('click', () => { state.page -= 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionNext.addEventListener('click', () => { state.page += 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.receivablePrev.addEventListener('click', () => { state.receivablePage -= 1; renderReceivables(); });
  refs.receivableNext.addEventListener('click', () => { state.receivablePage += 1; renderReceivables(); });
  refs.depositPrev.addEventListener('click', () => { state.depositPage -= 1; renderDeposits(); });
  refs.depositNext.addEventListener('click', () => { state.depositPage += 1; renderDeposits(); });
  refs.exportReceivablesXlsx.addEventListener('click', exportReceivables);
  refs.transactionRows.addEventListener('click', (event) => {
    const outstandingButton = event.target.closest('button[data-outstanding-appointment-id]');
    if (outstandingButton) {
      const record = state.rows.find((item) => Number(item.appointment_id) === Number(outstandingButton.dataset.outstandingAppointmentId));
      if (record) openRecordPayment(record, true);
      return;
    }
    const clientButton = event.target.closest('button[data-client-id]');
    if (clientButton) {
      showClientDetails(clientButton);
      return;
    }
    const receiptButton = event.target.closest('button[data-receipt-id]');
    if (receiptButton) {
      refs.receiptModalTitle.textContent = receiptButton.dataset.receiptTitle;
      const receiptUrl = `/api/finance/payments/${encodeURIComponent(receiptButton.dataset.receiptId)}/receipt`;
      refs.receiptFrame.src = receiptUrl;
      byId('exportReceiptXlsx').href = `${receiptUrl}?format=xlsx`;
      modalOpen(refs.receiptModal);
      return;
    }
    const reverseButton = event.target.closest('button[data-reverse-id]');
    if (reverseButton) {
      const payment = state.rows.find((row) => Number(row.payment_id) === Number(reverseButton.dataset.reverseId));
      if (!payment) return;
      refs.reversePaymentId.value = reverseButton.dataset.reverseId;
      const consequence = payment.payment_type === 'product_sale'
        ? 'This changes the ledger and restores the tracked inventory quantity; it does not return money to the customer.'
        : 'This changes the payment ledger only; it does not return money to the customer.';
      refs.reversePaymentSummary.textContent = `${payment.payment_date} · ${payment.receipt_number} · ${payment.reference_no || 'No external reference'} · ${common.formatPeso(payment.amount)}. ${consequence}`;
      refs.reverseReason.value = '';
      refs.reverseFormMessage.textContent = '';
      modalOpen(refs.reverseModal);
      return;
    }
    if (event.target.closest('a, button')) return;
    const row = event.target.closest('tr[data-payment-id], tr[data-appointment-id]');
    if (row?.dataset.appointmentId) showAppointmentDetails(row.dataset.appointmentId).catch((error) => message(error.message, true));
    else if (row) showPaymentDetails(row.dataset.paymentId).catch((error) => message(error.message, true));
  });
  refs.transactionRows.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('tr[data-payment-id], tr[data-appointment-id]')) {
      if (event.target.dataset.appointmentId) showAppointmentDetails(event.target.dataset.appointmentId).catch((error) => message(error.message, true));
      else showPaymentDetails(event.target.dataset.paymentId).catch((error) => message(error.message, true));
    }
  });
  refs.receivableRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-appointment-id]');
    if (!button) {
      const row = event.target.closest('tr[data-appointment-id]');
      if (row) showAppointmentDetails(row.dataset.appointmentId).catch((error) => message(error.message, true));
      return;
    }
    const record = state.receivables.find((item) => Number(item.appointment_id) === Number(button.dataset.appointmentId));
    if (record) openRecordPayment(record);
  });
  refs.depositRows.addEventListener('click', (event) => {
    const refundButton = event.target.closest('button[data-refund-id]');
    if (refundButton) {
      const deposit = state.deposits.find((row) => Number(row.payment_id) === Number(refundButton.dataset.refundId));
      if (!deposit) return;
      refs.refundPaymentId.value = deposit.payment_id;
      refs.refundPaymentSummary.textContent = `${deposit.payment_date} · Payment #${deposit.payment_id} · ${deposit.reference_no || 'No external reference'} · ${common.formatPeso(deposit.amount)}. Marking this posted cash deposit as refunded removes it from posted collections and updates its payment status.`;
      refs.refundNote.value = '';
      refs.refundFormMessage.textContent = '';
      modalOpen(refs.refundModal);
      return;
    }
    const row = event.target.closest('tr[data-payment-id]');
    if (row) showPaymentDetails(row.dataset.paymentId).catch((error) => message(error.message, true));
  });
  refs.recordPaymentForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!refs.recordPaymentForm.reportValidity()) return;
    const submitButton = refs.recordPaymentForm.querySelector('button[type="submit"]');
    const appointmentId = Number(refs.balanceAppointmentId.value);
    submitButton.disabled = true;
    let paymentRecorded = false;
    try {
      const requestKey = state.paymentRequestKeys.get(appointmentId);
      if (!requestKey) throw new Error('Reopen the payment form to create a secure payment request.');
      await common.fetchJson('/api/finance/payments', { method: 'POST', body: JSON.stringify({ request_key: requestKey, appointment_id: appointmentId, payment_type: 'balance', amount: Number(refs.balanceAmount.value), method: refs.balanceMethod.value, reference_no: refs.balanceReference.value.trim(), note: refs.balanceNote.value.trim() }) });
      paymentRecorded = true;
      modalClose(refs.recordPaymentModal);
      const fromLedger = refs.recordPaymentForm.dataset.fromLedger === 'true';
      refs.recordPaymentForm.dataset.fromLedger = 'false';
      if (fromLedger) await loadTransactions();
      else await loadReceivables();
      state.paymentRequestKeys.delete(appointmentId);
      message('Payment recorded.');
    } catch (error) {
      if (paymentRecorded) message(`Payment recorded, but Receivables could not refresh: ${error.message}`, true);
      else refs.paymentFormMessage.textContent = error.message;
    }
    finally { submitButton.disabled = false; }
  });
  refs.refundForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!refs.refundForm.reportValidity()) return;
    const submitButton = refs.refundForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await common.fetchJson(`/api/finance/payments/${encodeURIComponent(refs.refundPaymentId.value)}/refund`, { method: 'POST', body: JSON.stringify({ note: refs.refundNote.value.trim() }) });
      modalClose(refs.refundModal); await loadDeposits(); message('Reservation marked as refunded.');
    } catch (error) { refs.refundFormMessage.textContent = error.message; }
    finally { submitButton.disabled = false; }
  });
  refs.reverseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!refs.reverseForm.reportValidity()) return;
    const submitButton = refs.reverseForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await common.fetchJson(`/api/finance/payments/${encodeURIComponent(refs.reversePaymentId.value)}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: refs.reverseReason.value.trim() }),
      });
      modalClose(refs.reverseModal);
      await loadTransactions();
      message('Payment reversed in the ledger. No customer refund was issued.');
    } catch (error) {
      refs.reverseFormMessage.textContent = error.message;
    } finally { submitButton.disabled = false; }
  });
  refs.recordSaleBtn.addEventListener('click', () => openSaleModal());
  refs.exportTransactionsXlsx.addEventListener('click', exportTransactions);
  refs.clientPaymentHistoryBtn.addEventListener('click', () => showClientPaymentHistory());
  [refs.salePrice, refs.saleQuantity, refs.saleProduct].forEach((input) => input.addEventListener('input', updateSaleTotal));
  refs.saleProduct.addEventListener('change', updateSaleTotal);
  refs.saleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!refs.saleForm.reportValidity() || !saleRequestKey) return;
    refs.saleSubmit.disabled = true;
    refs.saleMessage.textContent = '';
    try {
      await common.fetchJson('/api/finance/product-sales', {
        method: 'POST',
        body: JSON.stringify({
          request_key: saleRequestKey,
          customer_id: Number(refs.saleClient.value) || null,
          product_id: Number(refs.saleProduct.value),
          quantity: Number(refs.saleQuantity.value),
          unit_price: Number(refs.salePrice.value),
          method: refs.saleMethod.value,
          reference_no: refs.saleReference.value.trim(),
        }),
      });
      modalClose(refs.saleModal);
      saleRequestKey = null;
      message('Sale recorded and inventory updated.');
      loadTransactions().catch((error) => message(`Sale recorded, but transactions could not be refreshed: ${error.message}`, true));
    } catch (error) {
      refs.saleMessage.textContent = error.message;
      refs.saleSubmit.disabled = false;
    }
  });
  [['[data-close-payment]', refs.recordPaymentModal], ['[data-close-sale]', refs.saleModal], ['[data-close-refund]', refs.refundModal], ['[data-close-reverse]', refs.reverseModal], ['[data-close-details]', refs.paymentDetailsModal], ['[data-close-receipt]', refs.receiptModal], ['[data-close-client]', refs.clientDetailsModal], ['[data-close-client-history]', refs.clientPaymentHistoryModal]].forEach(([selector, modal]) => document.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => modalClose(modal))));
  [refs.recordPaymentModal, refs.saleModal, refs.refundModal, refs.reverseModal, refs.paymentDetailsModal, refs.receiptModal, refs.clientDetailsModal, refs.clientPaymentHistoryModal].forEach((modal) => {
    common.bindAccessibleModal(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal) modalClose(modal); });
  });
  if (window.location.hash === '#receivables') setTab('receivables');
  else loadCurrentTab().catch((error) => message(error.message, true));
})();