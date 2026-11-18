(() => {
  const common = window.FinanceCommon;
  const panel = document.getElementById('transactionLedgerPanel');
  if (!common || !panel) return;

  const refs = {
    overview: document.getElementById('transactionOverview'),
    analytics: document.getElementById('transactionAnalyticsRow'),
    rows: document.getElementById('financeLedgerRows'),
    message: document.getElementById('financeLedgerMessage'),
    from: document.getElementById('financeLedgerFrom'),
    to: document.getElementById('financeLedgerTo'),
    direction: document.getElementById('financeLedgerDirection'),
    classification: document.getElementById('financeLedgerClassification'),
    method: document.getElementById('financeLedgerMethod'),
    source: document.getElementById('financeLedgerSource'),
    status: document.getElementById('financeLedgerStatus'),
    search: document.getElementById('financeLedgerSearch'),
    previous: document.getElementById('financeLedgerPrevious'),
    next: document.getElementById('financeLedgerNext'),
    pageLabel: document.getElementById('financeLedgerPageLabel'),
    exportButton: document.getElementById('financeLedgerExportXlsx'),
    incomeStatus: document.getElementById('transactionStatus'),
    moduleHeading: document.getElementById('financeModuleHeading')
  };
  const pageSize = 25;
  let page = 1;
  let total = 0;
  let loadSequence = 0;
  let searchTimer;

  const date = common.manilaToday();
  refs.from.value = common.monthStart(date);
  refs.to.value = date;

  function params(includePage) {
    const values = {
      from: refs.from.value,
      to: refs.to.value,
      direction: refs.direction.value,
      classification: refs.classification.value.trim(),
      method: refs.method.value.trim(),
      source: refs.source.value,
      status: refs.status.value,
      q: refs.search.value.trim()
    };
    if (includePage) {
      values.page = String(page);
      values.limit = String(pageSize);
    }
    return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== ''));
  }

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(cell);
  }

  function formatDate(row) {
    const value = String(row.transaction_at || '');
    if (row.source_type === 'expense') {
      const dateValue = String(row.transaction_date || '').slice(0, 10);
      return dateValue ? `${dateValue} (time not recorded)` : 'Not recorded';
    }
    if (!value) {
      const dateValue = String(row.transaction_date || '').slice(0, 10);
      return dateValue ? `${dateValue} (time not recorded)` : 'Not recorded';
    }
    const normalized = value.replace('T', ' ');
    return normalized.slice(0, 16);
  }

  function renderRows(rows) {
    refs.rows.replaceChildren();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'fin-ledger-empty';
      cell.colSpan = 12;
      cell.textContent = 'No transactions match these filters.';
      row.appendChild(cell);
      refs.rows.appendChild(row);
      return;
    }

    rows.forEach((record) => {
      const row = document.createElement('tr');
      appendCell(row, record.transaction_id);
      appendCell(row, formatDate(record));
      appendCell(row, record.direction === 'money_in' ? 'Money In' : 'Money Out');
      appendCell(row, record.counterparty);
      appendCell(row, record.purpose);
      appendCell(row, common.formatPeso(record.amount));
      appendCell(row, [record.source, record.destination].filter(Boolean).join(' / '));
      appendCell(row, record.classification);
      appendCell(row, record.payment_method || 'Not recorded');
      appendCell(row, record.reference_number);
      appendCell(row, record.status);
      appendCell(row, record.recorded_by_name);
      refs.rows.appendChild(row);
    });
  }

  async function loadLedger() {
    const requestId = ++loadSequence;
    refs.message.textContent = 'Loading transactions...';
    refs.previous.disabled = true;
    refs.next.disabled = true;
    try {
      const data = await common.fetchJson(`/api/finance/ledger?${params(true)}`);
      if (requestId !== loadSequence) return;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      total = Number(data.total) || 0;
      renderRows(rows);
      const first = total ? (page - 1) * pageSize + 1 : 0;
      refs.message.textContent = `Showing ${first}-${Math.min(page * pageSize, total)} of ${total} transactions.`;
      refs.pageLabel.textContent = `Page ${page}`;
      refs.previous.disabled = page <= 1;
      refs.next.disabled = page * pageSize >= total;
    } catch (error) {
      if (requestId !== loadSequence) return;
      renderRows([]);
      refs.message.textContent = error.message || 'Could not load the transaction ledger.';
    }
  }

  function setLedgerView(enabled) {
    panel.hidden = !enabled;
    const footer = document.getElementById('financeLedgerFooter');
    if (footer) footer.hidden = !enabled;
    if (enabled) {
      setActiveMenu('ledger');
      if (refs.moduleHeading) refs.moduleHeading.textContent = 'Transaction Ledger';
      document.title = 'Transaction Ledger';
      document.body.dataset.financeView = 'ledger';
      loadLedger();
      return;
    }
    delete document.body.dataset.financeView;
  }

  function setActiveMenu(view) {
    const navigation = document.querySelector('.staff-sidebar');
    const incomeLink = navigation?.querySelector('a[href="FinancesTransactions.html#income"]');
    const ledgerLink = navigation?.querySelector('a[href="FinancesTransactions.html#ledger"]');
    const incomeItem = incomeLink?.closest('.nav-item');
    const ledgerItem = ledgerLink?.closest('.nav-item');
    incomeItem?.classList.toggle('active', view === 'income');
    ledgerItem?.classList.toggle('active', view === 'ledger');
    if (view === 'ledger') {
      incomeLink?.removeAttribute('aria-current');
      ledgerLink?.setAttribute('aria-current', 'page');
    } else {
      ledgerLink?.removeAttribute('aria-current');
      incomeLink?.setAttribute('aria-current', 'page');
    }
    navigation?.querySelectorAll('.fin-nav-view-tab').forEach((button) => {
      button.classList.toggle('is-active', view !== 'ledger' && button.getAttribute('aria-selected') === 'true');
    });
  }

  function showIncome() {
    setLedgerView(false);
    setActiveMenu('income');
    if (refs.moduleHeading) refs.moduleHeading.textContent = 'Income';
    document.title = 'Income';
    const transactionsTab = document.getElementById('transactionViewTransactions');
    if (transactionsTab && !transactionsTab.classList.contains('is-active')) transactionsTab.click();
    if (refs.incomeStatus && refs.incomeStatus.value !== 'posted') {
      refs.incomeStatus.value = 'posted';
      refs.incomeStatus.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refs.overview?.scrollIntoView({ block: 'start' });
  }

  function handleRoute() {
    if (window.location.hash === '#ledger') {
      setLedgerView(true);
    } else if (window.location.hash === '#income') {
      showIncome();
    } else if (panel.hidden === false) {
      setLedgerView(false);
      setActiveMenu('income');
    } else {
      if (refs.moduleHeading) refs.moduleHeading.textContent = 'Income';
      document.title = 'Income';
    }
  }

  function reloadFromFirstPage() {
    page = 1;
    loadLedger();
  }

  function markActiveFilters() {
    [refs.direction, refs.classification, refs.method, refs.source, refs.status].forEach((input) => {
      input.closest('details').classList.toggle('is-filtered', Boolean(input.value.trim()) && input.value !== 'all');
    });
    refs.from.closest('details').classList.toggle('is-filtered', Boolean(refs.from.value || refs.to.value));
  }

  markActiveFilters();
  [refs.from, refs.to, refs.direction, refs.classification, refs.method, refs.source, refs.status]
    .forEach((input) => input.addEventListener('change', () => {
      markActiveFilters();
      reloadFromFirstPage();
    }));
  refs.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadFromFirstPage, 250);
  });
  panel.querySelectorAll('.fin-ledger-filter').forEach((filter) => {
    filter.addEventListener('toggle', () => {
      if (filter.open) panel.querySelectorAll('.fin-ledger-filter[open]').forEach((other) => {
        if (other !== filter) other.open = false;
      });
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.fin-ledger-filter')) {
      panel.querySelectorAll('.fin-ledger-filter[open]').forEach((filter) => { filter.open = false; });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      panel.querySelectorAll('.fin-ledger-filter[open]').forEach((filter) => {
        filter.open = false;
        filter.querySelector('summary').focus();
      });
    }
  });
  refs.previous.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      loadLedger();
    }
  });
  refs.next.addEventListener('click', () => {
    if (page * pageSize < total) {
      page += 1;
      loadLedger();
    }
  });
  refs.exportButton.addEventListener('click', () => {
    window.location.href = `/api/finance/ledger/export.xlsx?${params(false)}`;
  });

  document.querySelectorAll('.fin-nav-view-tab').forEach((button) => {
    button.addEventListener('click', () => {
      setLedgerView(false);
      setActiveMenu('income');
      if (button.dataset.tab === 'transactions') window.history.replaceState(null, '', '#income');
      else if (button.dataset.tab === 'receivables') window.history.replaceState(null, '', '#receivables');
      else window.history.replaceState(null, '', window.location.pathname);
    });
  });
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
})();
