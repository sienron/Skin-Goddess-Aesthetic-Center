(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const state = { tab: 'transactions', from: common.monthStart(), to: common.manilaToday(), type: '', method: '', search: '', page: 1, limit: 25, rows: [], receivables: [], deposits: [] };
  const byId = (id) => document.getElementById(id);
  const refs = Object.fromEntries(['transactionFrom', 'transactionTo', 'transactionType', 'transactionMethod', 'transactionSearch', 'transactionMessage', 'transactionRows', 'transactionCount', 'transactionEmpty', 'transactionPrev', 'transactionNext', 'transactionPageLabel', 'transactionPeriodLabel', 'receivablesPanel', 'transactionsPanel', 'depositsPanel', 'methodChartSection', 'receivableRows', 'receivableEmpty', 'receivableCount', 'depositRows', 'depositEmpty', 'depositCount', 'recordPaymentModal', 'recordPaymentForm', 'balanceAppointmentId', 'balanceAmount', 'balanceMethod', 'balanceReference', 'balanceNote', 'paymentBalanceText', 'paymentFormMessage', 'refundModal', 'refundForm', 'refundPaymentId', 'refundNote', 'refundFormMessage', 'paymentDetailsModal', 'paymentDetails', 'paymentHistoryRows'].map((id) => [id, byId(id)]));

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
  function modalOpen(modal) { modal.hidden = false; modal.querySelector('input:not([type="hidden"]), select, textarea')?.focus(); }
  function modalClose(modal) { modal.hidden = true; }
  function params(extra = {}) { return common.rangeParams(state.from, state.to, extra); }

  function renderTransactions() {
    refs.transactionRows.replaceChildren();
    state.rows.forEach((payment) => {
      const row = element('tr');
      row.tabIndex = 0;
      row.dataset.paymentId = payment.payment_id;
      cell(row, payment.payment_date);
      cell(row, payment.client);
      cell(row, payment.payment_type.replace('_', ' '));
      cell(row, payment.service || payment.reference_no || '-');
      cell(row, payment.method);
      cell(row, common.formatPeso(payment.amount));
      cell(row, payment.status);
      refs.transactionRows.append(row);
    });
    refs.transactionEmpty.hidden = state.rows.length > 0;
    refs.transactionCount.textContent = `${state.total} records`;
    refs.transactionPageLabel.textContent = `Page ${state.page}`;
    refs.transactionPrev.disabled = state.page <= 1;
    refs.transactionNext.disabled = state.page * state.limit >= state.total;
  }

  async function loadTransactions() {
    const filters = { page: state.page, limit: state.limit, type: state.type, method: state.method, q: state.search };
    const [result, chartRows] = await Promise.all([
      common.fetchJson(`/api/finance/transactions?${params(filters)}`),
      common.fetchJson(`/api/finance/by-method?${params({ type: state.type, method: state.method, q: state.search })}`),
    ]);
    state.rows = result.rows;
    state.total = result.total;
    renderTransactions();
    refs.transactionPeriodLabel.textContent = `${state.from} to ${state.to}`;
    common.renderChart('methodChart', {
      type: 'doughnut',
      data: { labels: chartRows.map((row) => row.method), datasets: [{ data: chartRows.map((row) => Number(row.amount)), backgroundColor: ['#C9A84C', '#228B46', '#4388E8', '#929292', '#8a6e2f'], borderWidth: 1, borderColor: '#fff' }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (item) => `${item.label}: ${common.formatPeso(item.raw)}` } } } },
    });
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
      cell(row, deposit.payment_date); cell(row, deposit.client); cell(row, deposit.appointment_date); cell(row, common.formatPeso(deposit.amount)); cell(row, deposit.method); cell(row, deposit.deposit_status);
      const action = element('td');
      if (deposit.deposit_status === 'paid') {
        const button = element('button', 'Mark as refunded', 'fin-button fin-button-danger');
        button.type = 'button'; button.dataset.refundId = deposit.payment_id; action.append(button);
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
      ['Client', data.payment.client], ['Service', data.payment.service || 'Product sale'],
      ['Appointment date', data.payment.appointment_date || '-'], ['Payment date', data.payment.payment_date],
      ['Amount', common.formatPeso(data.payment.amount)], ['Method', data.payment.method],
      ['Type', data.payment.payment_type], ['Status', data.payment.status],
      ['Reference', data.payment.reference_no || '-'], ['Note', data.payment.note || '-'],
    ];
    details.forEach(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = element('dt', label); const description = element('dd', value);
      wrapper.append(term, description); refs.paymentDetails.append(wrapper);
    });
    refs.paymentHistoryRows.replaceChildren();
    data.history.forEach((record) => {
      const row = element('tr'); cell(row, record.payment_date); cell(row, record.payment_type); cell(row, record.method); cell(row, common.formatPeso(record.amount)); cell(row, record.status); refs.paymentHistoryRows.append(row);
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
  refs.transactionFrom.addEventListener('change', () => { state.from = refs.transactionFrom.value; state.page = 1; loadCurrentTab().catch((error) => message(error.message, true)); });
  refs.transactionTo.addEventListener('change', () => { state.to = refs.transactionTo.value; state.page = 1; loadCurrentTab().catch((error) => message(error.message, true)); });
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
  [['[data-close-payment]', refs.recordPaymentModal], ['[data-close-refund]', refs.refundModal], ['[data-close-details]', refs.paymentDetailsModal]].forEach(([selector, modal]) => document.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => modalClose(modal))));
  [refs.recordPaymentModal, refs.refundModal, refs.paymentDetailsModal].forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) modalClose(modal); }));
  if (window.location.hash === '#receivables') setTab('receivables');
  else loadCurrentTab().catch((error) => message(error.message, true));
})();