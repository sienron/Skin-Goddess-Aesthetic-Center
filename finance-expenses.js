(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const state = { from: common.monthStart(), to: common.manilaToday(), category: '', search: '', page: 1, limit: 25, total: 0, rows: [] };
  let expenseRequest = 0;
  const elements = Object.fromEntries([
    'expenseFrom', 'expenseTo', 'expenseCategory', 'expenseSearch', 'expenseTotal', 'expenseComparison', 'machineExpenseTotal', 'utilitiesExpenseTotal', 'expensePeriodLabel',
    'expenseRows', 'expenseEmpty', 'expensePrev', 'expenseNext', 'expensePageLabel',
    'expensePageMessage', 'expenseModal', 'expenseForm', 'expenseId', 'expenseDate', 'expenseCategoryInput',
    'expenseDescription', 'expenseAmount', 'expenseSupplier', 'expenseReference', 'expenseFormMessage',
    'voidModal', 'voidForm', 'voidExpenseId', 'voidExpenseSummary', 'voidReason', 'voidFormMessage', 'addExpenseBtn',
    'exportExpensesXlsx',
    'expenseHistoryModal', 'expenseHistoryMessage', 'expenseHistoryRows', 'expenseHistoryEmpty',
  ].map((id) => [id, document.getElementById(id)]));

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showMessage(message, error = false) {
    elements.expensePageMessage.textContent = message;
    elements.expensePageMessage.style.color = error ? '#b93c3c' : '#4388e8';
  }

  function closeModal(modal) { common.closeAccessibleModal(modal); }
  function openModal(modal) { common.openAccessibleModal(modal); }

  function renderRows() {
    const body = elements.expenseRows;
    body.replaceChildren();
    for (const expense of state.rows) {
      const row = node('tr', expense.voided_at ? 'fin-row-voided' : '');
      [expense.expense_date, expense.category, expense.description, expense.supplier || '-', common.formatPeso(expense.amount)].forEach((value) => row.append(node('td', '', value)));
      const statusCell = node('td');
      const status = common.statusBadge(expense.voided_at ? 'voided' : 'active');
      if (expense.voided_at && expense.void_reason) status.title = `Voided: ${expense.void_reason}`;
      statusCell.append(status);
      row.append(statusCell);
      const actionsCell = node('td');
      const actions = node('div', 'fin-row-actions');
      const history = node('button', 'fin-button', 'History');
      history.type = 'button'; history.dataset.action = 'history'; history.dataset.id = expense.expense_id;
      actions.append(history);
      if (!expense.voided_at) {
        const edit = node('button', 'fin-button', 'Edit');
        edit.type = 'button'; edit.dataset.action = 'edit'; edit.dataset.id = expense.expense_id;
        const voidButton = node('button', 'fin-button fin-button-danger', 'Void');
        voidButton.type = 'button'; voidButton.dataset.action = 'void'; voidButton.dataset.id = expense.expense_id;
        actions.append(edit, voidButton);
      }
      actionsCell.append(actions); row.append(actionsCell); body.append(row);
    }
    elements.expenseEmpty.hidden = state.rows.length > 0;
    elements.expensePageLabel.textContent = `Page ${state.page}`;
    elements.expensePrev.disabled = state.page <= 1;
    elements.expenseNext.disabled = state.page * state.limit >= state.total;
  }

  async function loadExpenses() {
    const requestId = ++expenseRequest;
    const previous = common.previousRange(state.from, state.to);
    showMessage('');
    const params = common.rangeParams(state.from, state.to, { page: state.page, limit: state.limit, category: state.category, q: state.search });
    const [data, chartData, machineTrend, previousChartData] = await Promise.all([
      common.fetchJson(`/api/finance/expenses?${params}`),
      common.fetchJson(`/api/finance/expenses/by-category?${common.rangeParams(state.from, state.to, { category: state.category, q: state.search })}`),
      common.fetchJson(`/api/finance/expenses/machine-trend?${common.rangeParams(state.from, state.to, { category: state.category, q: state.search })}`),
      common.fetchJson(`/api/finance/expenses/by-category?${common.rangeParams(previous.from, previous.to, { category: state.category, q: state.search })}`),
    ]);
    if (requestId !== expenseRequest) return;
    state.rows = data.rows;
    state.total = data.total;
    renderRows();
    const categoryTotals = chartData.map((item) => ({ ...item, amount: Number(item.amount) }));
    const total = categoryTotals.reduce((sum, item) => sum + item.amount, 0);
    const previousRecordedTotal = previousChartData.reduce((sum, item) => sum + Number(item.amount), 0);
    elements.expenseTotal.textContent = common.formatPeso(total);
    elements.expenseComparison.textContent = `Recorded active expenses · ${common.formatComparison(total, previousRecordedTotal)} · previous ${previous.from} to ${previous.to}`;
    const machineTotal = machineTrend.reduce((sum, item) => sum + Number(item.amount), 0);
    elements.machineExpenseTotal.textContent = common.formatPeso(machineTotal);
    elements.utilitiesExpenseTotal.textContent = common.formatPeso(
      categoryTotals.find((item) => item.category === 'Utilities')?.amount || 0
    );
    elements.expensePeriodLabel.textContent = `${state.from} to ${state.to}`;
    const hasCategoryChartData = categoryTotals.some((item) => Number.isFinite(item.amount) && item.amount !== 0);
    document.getElementById('expenseCategoryChart').closest('.fin-chart-frame')
      .classList.toggle('is-empty', !hasCategoryChartData);
    common.renderChart('expenseCategoryChart', {
      type: 'bar',
      data: { labels: categoryTotals.map((item) => item.category), datasets: [{ label: 'Expenses', data: categoryTotals.map((item) => item.amount), backgroundColor: '#B93C3C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => common.formatPeso(item.raw) } } } },
    });
    const hasMachineChartData = machineTrend.some((item) => Number.isFinite(Number(item.amount)) && Number(item.amount) !== 0);
    document.getElementById('machineExpenseChart').closest('.fin-chart-frame')
      .classList.toggle('is-empty', !hasMachineChartData);
    common.renderChart('machineExpenseChart', {
      type: 'line',
      data: {
        labels: machineTrend.map((item) => item.week.slice(5)),
        datasets: [{
          label: 'Machine expenses',
          data: machineTrend.map((item) => Number(item.amount)),
          borderColor: '#B5892A',
          backgroundColor: 'rgba(181, 137, 42, 0.15)',
          pointBackgroundColor: '#B5892A',
          fill: true,
          tension: 0.25,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => common.formatPeso(item.raw) } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (value) => common.formatPeso(value) } },
        },
      },
    });
  }

  function serializeForm() {
    return {
      expense_date: elements.expenseDate.value,
      category: elements.expenseCategoryInput.value,
      description: elements.expenseDescription.value.trim(),
      amount: Number(elements.expenseAmount.value),
      supplier: elements.expenseSupplier.value.trim(),
      reference_no: elements.expenseReference.value.trim(),
    };
  }

  function editExpense(id) {
    const expense = state.rows.find((item) => Number(item.expense_id) === Number(id));
    if (!expense) return;
    elements.expenseId.value = expense.expense_id;
    elements.expenseDate.value = expense.expense_date;
    elements.expenseCategoryInput.value = expense.category;
    elements.expenseDescription.value = expense.description;
    elements.expenseAmount.value = expense.amount;
    elements.expenseSupplier.value = expense.supplier || '';
    elements.expenseReference.value = expense.reference_no || '';
    document.getElementById('expenseModalTitle').textContent = 'Edit expense';
    elements.expenseFormMessage.textContent = '';
    openModal(elements.expenseModal);
  }

  function changedValues(values) {
    const labels = {
      amount: 'Amount',
      category: 'Category',
      description: 'Description',
      expense_date: 'Date',
      reference_no: 'Reference',
      supplier: 'Supplier',
    };
    const list = node('ul', 'fin-audit-values');
    Object.keys(labels).forEach((key) => {
      const value = values[key];
      const display = key === 'amount' && value != null ? common.formatPeso(value) : value || '—';
      const item = node('li', '', `${labels[key]}: ${display}`);
      list.append(item);
    });
    return list;
  }

  async function showExpenseHistory(id) {
    elements.expenseHistoryRows.replaceChildren();
    elements.expenseHistoryEmpty.hidden = true;
    elements.expenseHistoryMessage.textContent = 'Loading edit history...';
    document.getElementById('expenseHistoryTitle').textContent = `Expense #${id} edit history`;
    openModal(elements.expenseHistoryModal);
    try {
      const result = await common.fetchJson(`/api/finance/expenses/${encodeURIComponent(id)}/history`);
      elements.expenseHistoryRows.replaceChildren();
      result.rows.forEach((record) => {
        const row = node('tr');
        row.append(
          node('td', '', new Date(record.edited_at).toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            dateStyle: 'medium',
            timeStyle: 'short',
          })),
          node('td', '', record.editor_name || `User #${record.edited_by}`),
        );
        const previous = node('td');
        previous.append(changedValues(record.previous_values));
        const updated = node('td');
        updated.append(changedValues(record.updated_values));
        row.append(previous, updated);
        elements.expenseHistoryRows.append(row);
      });
      elements.expenseHistoryEmpty.hidden = result.rows.length > 0;
      elements.expenseHistoryMessage.textContent = result.rows.length > 0
        ? `${result.rows.length} most recent edit${result.rows.length === 1 ? '' : 's'} shown (maximum 100).`
        : 'No edits have been recorded since edit history was enabled.';
    } catch (error) {
      elements.expenseHistoryMessage.textContent = `Could not load edit history: ${error.message}`;
    }
  }

  function exportExpenses() {
    const params = common.rangeParams(state.from, state.to, {
      section: 'expenses',
      category: state.category,
      q: state.search,
    });
    window.location.assign(`/api/finance/export.xlsx?${params}`);
  }

  elements.expenseFrom.value = state.from;
  elements.expenseTo.value = state.to;
  elements.expenseDate.value = common.manilaToday();
  elements.expenseCategory.addEventListener('change', () => { state.category = elements.expenseCategory.value; state.page = 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
  common.bindPeriodControls({
    fromInput: elements.expenseFrom,
    toInput: elements.expenseTo,
    buttons: document.querySelectorAll('[data-period]'),
    onChange: (range) => {
      state.from = range.from;
      state.to = range.to;
      state.page = 1;
      loadExpenses().catch((error) => showMessage(error.message, true));
    },
    onInvalid: (error) => showMessage(error, true),
  });
  let searchTimer;
  elements.expenseSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = elements.expenseSearch.value.trim(); state.page = 1; loadExpenses().catch((error) => showMessage(error.message, true)); }, 250);
  });
  elements.expensePrev.addEventListener('click', () => { state.page -= 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
  elements.expenseNext.addEventListener('click', () => { state.page += 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
  elements.addExpenseBtn.addEventListener('click', () => {
    elements.expenseForm.reset(); elements.expenseId.value = ''; elements.expenseDate.value = common.manilaToday();
    document.getElementById('expenseModalTitle').textContent = 'Add expense'; elements.expenseFormMessage.textContent = ''; openModal(elements.expenseModal);
  });
  elements.exportExpensesXlsx.addEventListener('click', exportExpenses);
  elements.expenseRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit') editExpense(button.dataset.id);
    if (button.dataset.action === 'history') showExpenseHistory(button.dataset.id);
    if (button.dataset.action === 'void') {
      const expense = state.rows.find((item) => Number(item.expense_id) === Number(button.dataset.id));
      if (!expense) return;
      elements.voidExpenseId.value = expense.expense_id;
      elements.voidReason.value = '';
      elements.voidExpenseSummary.textContent = `${expense.expense_date} · ${expense.reference_no || `Expense #${expense.expense_id}`} · ${common.formatPeso(expense.amount)}. Voiding keeps the record and reason in the ledger but excludes it from active totals. Expenses in closed cash-closing periods cannot be voided.`;
      elements.voidFormMessage.textContent = '';
      openModal(elements.voidModal);
    }
  });
  document.querySelectorAll('[data-close-expense]').forEach((button) => button.addEventListener('click', () => closeModal(elements.expenseModal)));
  document.querySelectorAll('[data-close-void]').forEach((button) => button.addEventListener('click', () => closeModal(elements.voidModal)));
  document.querySelectorAll('[data-close-expense-history]').forEach((button) => button.addEventListener('click', () => closeModal(elements.expenseHistoryModal)));
  [elements.expenseModal, elements.voidModal, elements.expenseHistoryModal].forEach((modal) => {
    common.bindAccessibleModal(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); });
  });

  elements.expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!elements.expenseForm.reportValidity()) return;
    const id = elements.expenseId.value;
    const url = id ? `/api/finance/expenses/${encodeURIComponent(id)}` : '/api/finance/expenses';
    const submitButton = elements.expenseForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await common.fetchJson(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(serializeForm()) });
      closeModal(elements.expenseModal); await loadExpenses(); showMessage(id ? 'Expense updated.' : 'Expense recorded.');
    } catch (error) { elements.expenseFormMessage.textContent = error.message; }
    finally { submitButton.disabled = false; }
  });

  elements.voidForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!elements.voidForm.reportValidity()) return;
    const submitButton = elements.voidForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await common.fetchJson(`/api/finance/expenses/${encodeURIComponent(elements.voidExpenseId.value)}/void`, { method: 'POST', body: JSON.stringify({ reason: elements.voidReason.value.trim() }) });
      closeModal(elements.voidModal); await loadExpenses(); showMessage('Expense voided. It remains in the ledger but is excluded from totals.');
    } catch (error) { elements.voidFormMessage.textContent = error.message; }
    finally { submitButton.disabled = false; }
  });

  loadExpenses().catch((error) => showMessage(error.message, true));
})();