(function () {
  const common = window.FinanceCommon;
  if (!common) return;

  const categories = ['Inventory & Supplies', 'Salaries & Commissions', 'Rent', 'Utilities', 'Marketing', 'Equipment Maintenance', 'Other'];
  const state = { from: common.monthStart(), to: common.manilaToday(), category: '', search: '', page: 1, limit: 25, total: 0, rows: [] };
  const elements = Object.fromEntries([
    'expenseFrom', 'expenseTo', 'expenseCategory', 'expenseSearch', 'expenseTotal', 'expensePeriodLabel',
    'expenseCount', 'expenseRows', 'expenseEmpty', 'expensePrev', 'expenseNext', 'expensePageLabel',
    'expensePageMessage', 'expenseModal', 'expenseForm', 'expenseId', 'expenseDate', 'expenseCategoryInput',
    'expenseDescription', 'expenseAmount', 'expenseSupplier', 'expenseReference', 'expenseFormMessage',
    'voidModal', 'voidForm', 'voidExpenseId', 'voidReason', 'voidFormMessage', 'addExpenseBtn',
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

  function closeModal(modal) { modal.hidden = true; }
  function openModal(modal) { modal.hidden = false; modal.querySelector('input:not([type="hidden"]), select, textarea')?.focus(); }

  function renderRows() {
    const body = elements.expenseRows;
    body.replaceChildren();
    for (const expense of state.rows) {
      const row = node('tr', expense.voided_at ? 'fin-row-voided' : '');
      [expense.expense_date, expense.category, expense.description, expense.supplier || '-', common.formatPeso(expense.amount), expense.voided_at ? `Voided: ${expense.void_reason || ''}` : 'Active'].forEach((value) => row.append(node('td', '', value)));
      const actionsCell = node('td');
      const actions = node('div', 'fin-row-actions');
      if (!expense.voided_at) {
        const edit = node('button', 'fin-button', 'Edit');
        edit.type = 'button'; edit.dataset.action = 'edit'; edit.dataset.id = expense.expense_id;
        const voidButton = node('button', 'fin-button fin-button-danger', 'Void');
        voidButton.type = 'button'; voidButton.dataset.action = 'void'; voidButton.dataset.id = expense.expense_id;
        actions.append(edit, voidButton);
      } else {
        actions.append(node('span', '', 'No actions'));
      }
      actionsCell.append(actions); row.append(actionsCell); body.append(row);
    }
    elements.expenseEmpty.hidden = state.rows.length > 0;
    elements.expenseCount.textContent = `${state.total} record${state.total === 1 ? '' : 's'}`;
    elements.expensePageLabel.textContent = `Page ${state.page}`;
    elements.expensePrev.disabled = state.page <= 1;
    elements.expenseNext.disabled = state.page * state.limit >= state.total;
  }

  async function loadExpenses() {
    showMessage('');
    const params = common.rangeParams(state.from, state.to, { page: state.page, limit: state.limit, category: state.category, q: state.search });
    const [data, chartData] = await Promise.all([
      common.fetchJson(`/api/finance/expenses?${params}`),
      common.fetchJson(`/api/finance/expenses/by-category?${common.rangeParams(state.from, state.to, { category: state.category, q: state.search })}`),
    ]);
    state.rows = data.rows;
    state.total = data.total;
    renderRows();
    const total = chartData.reduce((sum, item) => sum + Number(item.amount), 0);
    elements.expenseTotal.textContent = common.formatPeso(total);
    elements.expensePeriodLabel.textContent = `${state.from} to ${state.to}`;
    common.renderChart('expenseCategoryChart', {
      type: 'bar',
      data: { labels: chartData.map((item) => item.category), datasets: [{ label: 'Expenses', data: chartData.map((item) => Number(item.amount)), backgroundColor: '#B93C3C', borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => common.formatPeso(item.raw) } } } },
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

  elements.expenseFrom.value = state.from;
  elements.expenseTo.value = state.to;
  elements.expenseDate.value = common.manilaToday();
  elements.expenseCategory.addEventListener('change', () => { state.category = elements.expenseCategory.value; state.page = 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
  elements.expenseFrom.addEventListener('change', () => { state.from = elements.expenseFrom.value; state.page = 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
  elements.expenseTo.addEventListener('change', () => { state.to = elements.expenseTo.value; state.page = 1; loadExpenses().catch((error) => showMessage(error.message, true)); });
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
  elements.expenseRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit') editExpense(button.dataset.id);
    if (button.dataset.action === 'void') {
      elements.voidExpenseId.value = button.dataset.id; elements.voidReason.value = ''; elements.voidFormMessage.textContent = ''; openModal(elements.voidModal);
    }
  });
  document.querySelectorAll('[data-close-expense]').forEach((button) => button.addEventListener('click', () => closeModal(elements.expenseModal)));
  document.querySelectorAll('[data-close-void]').forEach((button) => button.addEventListener('click', () => closeModal(elements.voidModal)));
  [elements.expenseModal, elements.voidModal].forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); }));

  elements.expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!elements.expenseForm.reportValidity()) return;
    const id = elements.expenseId.value;
    const url = id ? `/api/finance/expenses/${encodeURIComponent(id)}` : '/api/finance/expenses';
    try {
      await common.fetchJson(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(serializeForm()) });
      closeModal(elements.expenseModal); await loadExpenses(); showMessage(id ? 'Expense updated.' : 'Expense recorded.');
    } catch (error) { elements.expenseFormMessage.textContent = error.message; }
  });

  elements.voidForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!elements.voidForm.reportValidity()) return;
    try {
      await common.fetchJson(`/api/finance/expenses/${encodeURIComponent(elements.voidExpenseId.value)}/void`, { method: 'POST', body: JSON.stringify({ reason: elements.voidReason.value.trim() }) });
      closeModal(elements.voidModal); await loadExpenses(); showMessage('Expense voided. It remains in the ledger but is excluded from totals.');
    } catch (error) { elements.voidFormMessage.textContent = error.message; }
  });

  if (!categories.length) return;
  loadExpenses().catch((error) => showMessage(error.message, true));
})();