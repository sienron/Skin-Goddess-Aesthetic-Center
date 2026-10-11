(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const state = { tab: 'transactions', from: common.monthStart(), to: common.manilaToday(), type: '', method: '', search: '', page: 1, limit: 25, rows: [], receivables: [], deposits: [] };
  let transactionRequest = 0;
  const byId = (id) => document.getElementById(id);
  const refs = Object.fromEntries(['transactionFrom', 'transactionTo', 'transactionType', 'transactionMethod', 'transactionSearch', 'transactionMessage', 'transactionRows', 'transactionCount', 'transactionEmpty', 'transactionPrev', 'transactionNext', 'transactionPageLabel', 'transactionPeriodLabel', 'transactionComparison', 'receivablesPanel', 'transactionsPanel', 'depositsPanel', 'methodChartSection', 'receivableRows', 'receivableEmpty', 'receivableCount', 'depositRows', 'depositEmpty', 'depositCount', 'recordPaymentModal', 'recordPaymentForm', 'balanceAppointmentId', 'balanceAmount', 'balanceMethod', 'balanceReference', 'balanceNote', 'paymentBalanceText', 'paymentFormMessage', 'saleModal', 'saleForm', 'saleProduct', 'saleQuantity', 'salePrice', 'saleTotal', 'saleMethod', 'saleReference', 'saleMessage', 'saleSubmit', 'recordSaleBtn', 'exportTransactionsXlsx', 'refundModal', 'refundForm', 'refundPaymentId', 'refundNote', 'refundFormMessage', 'reverseModal', 'reverseForm', 'reversePaymentId', 'reverseReason', 'reverseFormMessage', 'paymentDetailsModal', 'paymentDetails', 'paymentHistoryRows'].map((id) => [id, byId(id)]));
  let saleRequestKey = null;
  let saleProducts = [];

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

  function renderTransactions() {
    refs.transactionRows.replaceChildren();
    state.rows.forEach((payment) => {
      const row = element('tr');
      row.tabIndex = 0;
      row.dataset.paymentId = payment.payment_id;
      cell(row, payment.payment_date);
      cell(row, payment.receipt_number);
      cell(row, payment.client);
      cell(row, payment.payment_type.replace('_', ' '));
      cell(row, payment.service || payment.reference_no || '-');
      cell(row, common.paymentMethodLabel(payment.method));
      cell(row, common.formatPeso(payment.amount));
      const status = element('td');
      status.append(common.statusBadge(payment.status));
      row.append(status);
      const action = element('td');
      const actionButtons = element('div', '', 'fin-row-actions');
      const receiptLink = element('a', 'Receipt', 'fin-button');
      receiptLink.href = `/api/finance/payments/${encodeURIComponent(payment.payment_id)}/receipt`;
      receiptLink.target = '_blank';
      receiptLink.rel = 'noopener noreferrer';
      actionButtons.append(receiptLink);
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
    refs.transactionCount.textContent = `${state.total} records`;
    refs.transactionPageLabel.textContent = `Page ${state.page}`;
    refs.transactionPrev.disabled = state.page <= 1;
    refs.transactionNext.disabled = state.page * state.limit >= state.total;
  }

  async function loadTransactions() {
    const requestId = ++transactionRequest;
    const previous = common.previousRange(state.from, state.to);
    const filters = { page: state.page, limit: state.limit, type: state.type, method: state.method, q: state.search };
    const previousFilters = { type: state.type, method: state.method, q: state.search };
    const [result, chartRows, previousChartRows] = await Promise.all([
      common.fetchJson(`/api/finance/transactions?${params(filters)}`),
      common.fetchJson(`/api/finance/by-method?${params({ type: state.type, method: state.method, q: state.search })}`),
      common.fetchJson(`/api/finance/by-method?${common.rangeParams(previous.from, previous.to, previousFilters)}`),
    ]);
    if (requestId !== transactionRequest) return;
    state.rows = result.rows;
    state.total = result.total;
    renderTransactions();
    refs.transactionPeriodLabel.textContent = `${state.from} to ${state.to}`;
    const collected = chartRows.reduce((sum, row) => sum + Number(row.amount), 0);
    const previousCollected = previousChartRows.reduce((sum, row) => sum + Number(row.amount), 0);
    refs.transactionComparison.textContent = `Posted collections: ${common.formatComparison(collected, previousCollected)} · previous ${previous.from} to ${previous.to}`;
    common.renderChart('methodChart', {
      type: 'doughnut',
      data: { labels: chartRows.map((row) => common.paymentMethodLabel(row.method)), datasets: [{ data: chartRows.map((row) => Number(row.amount)), backgroundColor: ['#C9A84C', '#228B46', '#4388E8', '#929292', '#8a6e2f'], borderWidth: 1, borderColor: '#fff' }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${common.formatPeso(item.raw)}` } } } },
    });
  }

  function createSaleRequestKey() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function openSaleModal() {
    refs.saleForm.reset();
    refs.saleQuantity.value = '1';
    refs.saleQuantity.removeAttribute('max');
    refs.saleProduct.replaceChildren(new Option('Choose product', ''));
    refs.saleMessage.textContent = '';
    saleRequestKey = createSaleRequestKey();
    refs.saleSubmit.disabled = true;
    modalOpen(refs.saleModal);
    try {
      saleProducts = await common.fetchJson('/api/finance/sale-products');
      saleProducts.forEach((product) => {
        refs.saleProduct.add(new Option(
          `${product.product_name} (${product.stock_quantity} in stock)`,
          product.product_id,
        ));
      });
      refs.saleSubmit.disabled = saleProducts.length === 0;
      if (!saleProducts.length) refs.saleMessage.textContent = 'There are no in-stock products to sell.';
    } catch (error) {
      refs.saleMessage.textContent = error.message;
    }
  }

  function updateSaleTotal() {
    const total = Number(refs.salePrice.value) * Number(refs.saleQuantity.value);
    refs.saleTotal.textContent = common.formatPeso(Number.isFinite(total) ? total : 0);
    const selectedProduct = saleProducts.find((product) => Number(product.product_id) === Number(refs.saleProduct.value));
    if (selectedProduct) refs.saleQuantity.max = selectedProduct.stock_quantity;
  }

  function exportTransactions() {
    const query = params({
      section: 'transactions',
      type: state.type,
      method: state.method,
      q: state.search,
    });
    window.location.assign(`/api/finance/export.xlsx?${query}`);
  }

  async function loadReceivables() {
    state.receivables = await common.fetchJson(`/api/finance/receivables?${params()}`);
    refs.receivableRows.replaceChildren();
    state.receivables.forEach((item) => {
      const row = element('tr');
      row.tabIndex = 0;
      row.dataset.appointmentId = item.appointment_id;
      cell(row, item.appointment_date); cell(row, item.client); cell(row, item.service);
      cell(row, common.formatPeso(item.service_price)); cell(row, common.formatPeso(item.outstanding));
      const action = element('td');
      const button = element('button', 'Record payment', 'fin-button fin-button-primary');
      button.type = 'button'; button.dataset.appointmentId = item.appointment_id;
      action.append(button); row.append(action); refs.receivableRows.append(row);
    });
    refs.receivableEmpty.hidden = state.receivables.length > 0;
    refs.receivableCount.textContent = `${state.receivables.length} appointment${state.receivables.length === 1 ? '' : 's'}`;
  }

  async function loadDeposits() {
    state.deposits = await common.fetchJson(`/api/finance/deposits?${params()}`);
    refs.depositRows.replaceChildren();
    state.deposits.forEach((deposit) => {
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
    refs.depositEmpty.hidden = state.deposits.length > 0;
    refs.depositCount.textContent = `${state.deposits.length} deposits`;
  }

  async function loadCurrentTab() {
    message('');
    refs.transactionsPanel.hidden = state.tab !== 'transactions';
    refs.receivablesPanel.hidden = state.tab !== 'receivables';
    refs.depositsPanel.hidden = state.tab !== 'deposits';
    refs.methodChartSection.hidden = state.tab !== 'transactions';
    byId('typeFilterWrap').hidden = state.tab !== 'transactions';
    byId('methodFilterWrap').hidden = state.tab !== 'transactions';
    byId('transactionSearchWrap').hidden = state.tab !== 'transactions';
    if (state.tab === 'transactions') await loadTransactions();
    if (state.tab === 'receivables') await loadReceivables();
    if (state.tab === 'deposits') await loadDeposits();
  }

  function renderPaymentDetails(data) {
    refs.paymentDetails.replaceChildren();
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
      const term = element('dt', label);
      const description = element('dd');
      if (label === 'Status') description.append(common.statusBadge(value));
      else description.textContent = value == null ? '-' : String(value);
      wrapper.append(term, description); refs.paymentDetails.append(wrapper);
    });
    refs.paymentHistoryRows.replaceChildren();
    data.history.forEach((record) => {
      const row = element('tr'); cell(row, record.payment_date); cell(row, record.payment_type); cell(row, common.paymentMethodLabel(record.method)); cell(row, common.formatPeso(record.amount));
      const status = element('td'); status.append(common.statusBadge(record.status)); row.append(status); refs.paymentHistoryRows.append(row);
    });
    modalOpen(refs.paymentDetailsModal);
  }

  async function showPaymentDetails(paymentId) {
    renderPaymentDetails(await common.fetchJson(`/api/finance/payments/${encodeURIComponent(paymentId)}`));
  }

  async function showAppointmentDetails(appointmentId) {
    renderPaymentDetails(await common.fetchJson(`/api/finance/appointments/${encodeURIComponent(appointmentId)}`));
  }

  function setTab(tab) {
    state.tab = tab;
    state.page = 1;
    document.querySelectorAll('.fin-tab').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    loadCurrentTab().catch((error) => message(error.message, true));
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
      loadCurrentTab().catch((error) => message(error.message, true));
    },
    onInvalid: (error) => message(error, true),
  });
  refs.transactionType.addEventListener('change', () => { state.type = refs.transactionType.value; state.page = 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionMethod.addEventListener('change', () => { state.method = refs.transactionMethod.value; state.page = 1; loadTransactions().catch((error) => message(error.message, true)); });
  let searchTimer;
  refs.transactionSearch.addEventListener('input', () => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = refs.transactionSearch.value.trim(); state.page = 1; loadTransactions().catch((error) => message(error.message, true)); }, 250);
  });
  document.querySelectorAll('.fin-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  refs.transactionPrev.addEventListener('click', () => { state.page -= 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionNext.addEventListener('click', () => { state.page += 1; loadTransactions().catch((error) => message(error.message, true)); });
  refs.transactionRows.addEventListener('click', (event) => {
    const reverseButton = event.target.closest('button[data-reverse-id]');
    if (reverseButton) {
      refs.reversePaymentId.value = reverseButton.dataset.reverseId;
      refs.reverseReason.value = '';
      refs.reverseFormMessage.textContent = '';
      modalOpen(refs.reverseModal);
      return;
    }
    if (event.target.closest('a, button')) return;
    const row = event.target.closest('tr[data-payment-id]');
    if (row) showPaymentDetails(row.dataset.paymentId).catch((error) => message(error.message, true));
  });
  refs.transactionRows.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('tr[data-payment-id]')) showPaymentDetails(event.target.dataset.paymentId).catch((error) => message(error.message, true));
  });
  refs.receivableRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-appointment-id]');
    if (!button) {
      const row = event.target.closest('tr[data-appointment-id]');
      if (row) showAppointmentDetails(row.dataset.appointmentId).catch((error) => message(error.message, true));
      return;
    }
    const record = state.receivables.find((item) => Number(item.appointment_id) === Number(button.dataset.appointmentId));
    if (!record) return;
    refs.balanceAppointmentId.value = record.appointment_id;
    refs.balanceAmount.value = Number(record.outstanding).toFixed(2);
    refs.balanceAmount.max = Number(record.outstanding).toFixed(2);
    refs.balanceMethod.value = ''; refs.balanceReference.value = ''; refs.balanceNote.value = '';
    refs.paymentBalanceText.textContent = `${record.client} - ${record.service}: ${common.formatPeso(record.outstanding)} outstanding`;
    refs.paymentFormMessage.textContent = ''; modalOpen(refs.recordPaymentModal);
  });
  refs.depositRows.addEventListener('click', (event) => {
    const refundButton = event.target.closest('button[data-refund-id]');
    if (refundButton) {
      refs.refundPaymentId.value = refundButton.dataset.refundId; refs.refundNote.value = ''; refs.refundFormMessage.textContent = ''; modalOpen(refs.refundModal); return;
    }
    const row = event.target.closest('tr[data-payment-id]');
    if (row) showPaymentDetails(row.dataset.paymentId).catch((error) => message(error.message, true));
  });
  refs.recordPaymentForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!refs.recordPaymentForm.reportValidity()) return;
    try {
      await common.fetchJson('/api/finance/payments', { method: 'POST', body: JSON.stringify({ appointment_id: Number(refs.balanceAppointmentId.value), payment_type: 'balance', amount: Number(refs.balanceAmount.value), method: refs.balanceMethod.value, reference_no: refs.balanceReference.value.trim(), note: refs.balanceNote.value.trim() }) });
      modalClose(refs.recordPaymentModal); await loadReceivables(); message('Payment recorded.');
    } catch (error) { refs.paymentFormMessage.textContent = error.message; }
  });
  refs.refundForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!refs.refundForm.reportValidity()) return;
    try {
      await common.fetchJson(`/api/finance/payments/${encodeURIComponent(refs.refundPaymentId.value)}/refund`, { method: 'POST', body: JSON.stringify({ note: refs.refundNote.value.trim() }) });
      modalClose(refs.refundModal); await loadDeposits(); message('Reservation marked as refunded.');
    } catch (error) { refs.refundFormMessage.textContent = error.message; }
  });
  refs.reverseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!refs.reverseForm.reportValidity()) return;
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
    }
  });
  refs.recordSaleBtn.addEventListener('click', () => openSaleModal());
  refs.exportTransactionsXlsx.addEventListener('click', exportTransactions);
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
  [['[data-close-payment]', refs.recordPaymentModal], ['[data-close-sale]', refs.saleModal], ['[data-close-refund]', refs.refundModal], ['[data-close-reverse]', refs.reverseModal], ['[data-close-details]', refs.paymentDetailsModal]].forEach(([selector, modal]) => document.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => modalClose(modal))));
  [refs.recordPaymentModal, refs.saleModal, refs.refundModal, refs.reverseModal, refs.paymentDetailsModal].forEach((modal) => {
    common.bindAccessibleModal(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal) modalClose(modal); });
  });
  if (window.location.hash === '#receivables') setTab('receivables');
  else loadCurrentTab().catch((error) => message(error.message, true));
})();