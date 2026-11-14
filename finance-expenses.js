(function () {
  const common = window.FinanceCommon;
  if (!common) return;
  const state = { from: common.monthStart(), to: common.manilaToday(), category: '', search: '', sort: 'date', direction: 'desc', page: 1, limit: 25, total: 0, rows: [], pendingPurchases: [], selectedPurchase: null, reviewBusy: false };
  let expenseRequest = 0;
  let purchaseDetailRequest = 0;
  const elements = Object.fromEntries([
    'expenseFrom', 'expenseTo', 'expenseCategory', 'expenseSearch', 'expenseTotal', 'expenseComparison', 'utilitiesExpenseTotal',
    'expenseRows', 'expenseEmpty', 'expensePrev', 'expenseNext', 'expensePageLabel',
    'expensePageMessage', 'expenseModal', 'expenseForm', 'expenseId', 'expenseDate', 'expenseCategoryInput',
    'expenseDescription', 'expenseAmount', 'expenseSupplier', 'expenseReference', 'expenseFormMessage',
    'voidModal', 'voidForm', 'voidExpenseId', 'voidExpenseSummary', 'voidReason', 'voidFormMessage', 'addExpenseBtn',
    'exportExpensesXlsx',
    'expenseHistoryModal', 'expenseHistoryMessage', 'expenseHistoryRows', 'expenseHistoryEmpty',
    'pendingExpenseReviewBtn', 'pendingExpenseReviewBadge', 'pendingExpenseReviewModal',
    'pendingExpenseReviewMessage', 'pendingPurchaseListView', 'pendingPurchaseRows',
    'pendingPurchaseEmpty', 'pendingPurchaseDetailModal', 'pendingPurchaseDetailView',
    'pendingPurchaseDetailMessage', 'purchaseReviewCancelActions',
    'purchaseReviewDetails', 'purchaseRejectionForm', 'purchaseRejectionReason',
    'purchaseReviewActionMessage', 'approvePurchaseBtn', 'rejectPurchaseBtn',
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
      const recordedByName = expense.recorded_by_name
        || (expense.recorded_by ? `User #${expense.recorded_by}` : 'Unknown');
      const recordedByRole = {
        admin: 'Admin',
        finance_officer: 'Finance Officer',
        inventory_officer: 'Inventory Officer',
      }[expense.recorded_by_role] || expense.recorded_by_role || 'Unknown role';
      row.append(node('td', '', `${recordedByName} (${recordedByRole})`));
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
    const params = common.rangeParams(state.from, state.to, { page: state.page, limit: state.limit, category: state.category, q: state.search, sort: state.sort, direction: state.direction });
    const [data, chartData, previousChartData] = await Promise.all([
      common.fetchJson(`/api/finance/expenses?${params}`),
      common.fetchJson(`/api/finance/expenses/by-category?${common.rangeParams(state.from, state.to, { category: state.category, q: state.search })}`),
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
    elements.utilitiesExpenseTotal.textContent = common.formatPeso(
      categoryTotals.find((item) => item.category === 'Utilities')?.amount || 0
    );
  }

  function updatePendingPurchaseBadge(count) {
    elements.pendingExpenseReviewBadge.textContent = String(count);
    elements.pendingExpenseReviewBtn.setAttribute(
      'aria-label',
      `Pending expense review, ${count} pending purchase${count === 1 ? '' : 's'}`,
    );
    elements.pendingExpenseReviewBtn.title = `${count} pending inventory purchase${count === 1 ? '' : 's'}`;
  }

  function markPendingPurchaseCountUnavailable(error) {
    elements.pendingExpenseReviewBadge.textContent = '!';
    elements.pendingExpenseReviewBtn.setAttribute(
      'aria-label',
      'Pending expense review, pending count unavailable',
    );
    elements.pendingExpenseReviewBtn.title = `Pending purchase count unavailable: ${error.message}`;
  }

  function renderPendingPurchases() {
    elements.pendingPurchaseRows.replaceChildren();
    state.pendingPurchases.forEach((purchase) => {
      const row = node('tr');
      [
        purchase.purchase_date,
        purchase.product_name,
        purchase.quantity,
        common.formatPeso(purchase.unit_price),
        common.formatPeso(purchase.total_cost),
        purchase.recorded_by || 'Unknown',
      ].forEach((value) => row.append(node('td', '', value)));
      const actionCell = node('td');
      const reviewButton = node('button', 'fin-button', 'Review');
      reviewButton.type = 'button';
      reviewButton.dataset.purchaseId = purchase.purchase_id;
      reviewButton.addEventListener('click', () => {
        if (!reviewButton.disabled) openPurchaseReviewDetails(String(purchase.purchase_id));
      });
      actionCell.append(reviewButton);
      row.append(actionCell);
      elements.pendingPurchaseRows.append(row);
    });
    elements.pendingPurchaseEmpty.hidden = state.pendingPurchases.length > 0;
  }

  async function refreshPendingPurchases() {
    const records = await common.fetchJson('/api/finance/inventory-purchase-suggestions');
    if (!Array.isArray(records)) throw new Error('Pending purchase response was not a list.');
    state.pendingPurchases = records;
    updatePendingPurchaseBadge(records.length);
    renderPendingPurchases();
    return records;
  }

  async function openPendingExpenseReview() {
    elements.pendingPurchaseListView.hidden = false;
    elements.pendingExpenseReviewMessage.textContent = 'Loading pending purchases…';
    elements.pendingPurchaseEmpty.hidden = true;
    openModal(elements.pendingExpenseReviewModal);
    try {
      const records = await refreshPendingPurchases();
      elements.pendingExpenseReviewMessage.textContent = records.length
        ? `${records.length} purchase${records.length === 1 ? '' : 's'} awaiting review.`
        : '';
    } catch (error) {
      markPendingPurchaseCountUnavailable(error);
      elements.pendingExpenseReviewMessage.textContent = `Could not load pending purchases: ${error.message}`;
    }
  }

  function appendPurchaseDetail(label, value) {
    const wrapper = node('div');
    wrapper.append(node('dt', '', label), node('dd', '', value == null || value === '' ? '—' : value));
    elements.purchaseReviewDetails.append(wrapper);
  }

  async function openPurchaseReviewDetails(purchaseId) {
    const requestId = ++purchaseDetailRequest;
    state.selectedPurchase = null;
    elements.purchaseReviewDetails.replaceChildren();
    elements.pendingPurchaseDetailMessage.textContent = 'Loading purchase details…';
    elements.purchaseReviewActionMessage.textContent = '';
    elements.purchaseRejectionReason.value = '';
    elements.purchaseRejectionForm.hidden = true;
    elements.purchaseReviewCancelActions.hidden = false;
    closeModal(elements.pendingExpenseReviewModal);
    openModal(elements.pendingPurchaseDetailModal);
    try {
      const purchase = await common.fetchJson(
        `/api/finance/inventory-purchase-suggestions/${encodeURIComponent(purchaseId)}`,
      );
      if (requestId !== purchaseDetailRequest) return;
      state.selectedPurchase = purchase;
      appendPurchaseDetail('Product name', purchase.product_name);
      appendPurchaseDetail('Quantity received', purchase.quantity);
      appendPurchaseDetail('Unit purchase cost', common.formatPeso(purchase.unit_price));
      appendPurchaseDetail('Total purchase cost', common.formatPeso(purchase.total_cost));
      appendPurchaseDetail('Purchase date', purchase.purchase_date);
      appendPurchaseDetail('Inventory Officer', purchase.recorded_by || 'Unknown');
      appendPurchaseDetail('Purchase batch', `#${purchase.purchase_batch_id}`);
      appendPurchaseDetail(
        'Original invoice/receipt',
        purchase.invoice_source_hash
          ? `Invoice file is not retained. Source image SHA-256: ${purchase.invoice_source_hash}`
          : 'No original invoice image fingerprint is available.',
      );
      if (purchase.review_status === 'rejected') {
        appendPurchaseDetail('Rejection reason', purchase.rejection_reason);
        appendPurchaseDetail('Rejected by', purchase.rejector_name);
        appendPurchaseDetail('Rejected at', purchase.rejected_at);
      } else if (purchase.review_status === 'approved') {
        appendPurchaseDetail('Expense ID', purchase.expense_id);
        appendPurchaseDetail('Reviewed by', purchase.reviewer_name);
        appendPurchaseDetail('Reviewed at', purchase.reviewed_at);
      }
      const canReview = purchase.review_status === 'pending' && !purchase.expense_id;
      const hasPositiveCost = Number(purchase.total_cost) > 0;
      elements.purchaseRejectionForm.hidden = !canReview;
      elements.purchaseReviewCancelActions.hidden = canReview;
      elements.purchaseRejectionReason.value = '';
      elements.purchaseReviewActionMessage.textContent = canReview
        ? (hasPositiveCost ? '' : 'A purchase with a zero total cannot be recorded as an expense.')
        : `This purchase is already ${purchase.review_status}.`;
      elements.approvePurchaseBtn.disabled = !canReview || !hasPositiveCost;
      elements.rejectPurchaseBtn.disabled = !canReview;
      elements.pendingPurchaseDetailMessage.textContent = '';
    } catch (error) {
      if (requestId === purchaseDetailRequest) {
        elements.pendingPurchaseDetailMessage.textContent = `Could not load purchase details: ${error.message}`;
      }
    }
  }

  function closePurchaseReviewDetails() {
    purchaseDetailRequest += 1;
    state.selectedPurchase = null;
    closeModal(elements.pendingPurchaseDetailModal);
    openModal(elements.pendingExpenseReviewModal);
  }

  async function submitPurchaseReview(action) {
    const purchase = state.selectedPurchase;
    if (!purchase || state.reviewBusy) return;
    if (action === 'reject' && !elements.purchaseRejectionForm.reportValidity()) return;

    state.reviewBusy = true;
    elements.approvePurchaseBtn.disabled = true;
    elements.rejectPurchaseBtn.disabled = true;
    elements.purchaseReviewActionMessage.textContent = '';
    try {
      const endpoint = `/api/finance/inventory-purchase-suggestions/${encodeURIComponent(purchase.purchase_id)}/${action}`;
      const body = action === 'reject'
        ? { reason: elements.purchaseRejectionReason.value.trim() }
        : {};
      await common.fetchJson(endpoint, { method: 'POST', body: JSON.stringify(body) });

      state.pendingPurchases = state.pendingPurchases.filter(
        (item) => Number(item.purchase_id) !== Number(purchase.purchase_id),
      );
      updatePendingPurchaseBadge(state.pendingPurchases.length);
      renderPendingPurchases();
      closePurchaseReviewDetails();
      elements.pendingExpenseReviewMessage.textContent = action === 'approve'
        ? 'Purchase approved and expense recorded.'
        : 'Purchase rejected. Inventory stock was not changed.';
      state.selectedPurchase = null;

      try {
        await refreshPendingPurchases();
      } catch (error) {
        markPendingPurchaseCountUnavailable(error);
        elements.pendingExpenseReviewMessage.textContent += ` Pending count refresh failed: ${error.message}`;
      }
      if (action === 'approve') {
        try {
          await loadExpenses();
          showMessage('Purchase approved and recorded as an expense.');
        } catch (error) {
          showMessage(`Purchase was approved, but expense records could not be refreshed: ${error.message}`, true);
        }
      }
    } catch (error) {
      elements.purchaseReviewActionMessage.textContent = error.message;
      try {
        await refreshPendingPurchases();
      } catch (refreshError) {
        markPendingPurchaseCountUnavailable(refreshError);
        elements.purchaseReviewActionMessage.textContent += ` Pending count refresh failed: ${refreshError.message}`;
      }
    } finally {
      state.reviewBusy = false;
      if (state.selectedPurchase?.review_status === 'pending') {
        elements.approvePurchaseBtn.disabled = Number(state.selectedPurchase.total_cost) <= 0;
        elements.rejectPurchaseBtn.disabled = false;
      }
    }
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
  const expenseSortButtons = [...document.querySelectorAll('.fin-expense-records [data-sort-column]')];
  function updateExpenseSortIndicators() {
    expenseSortButtons.forEach((button) => {
      const active = button.dataset.sortColumn === state.sort;
      const heading = button.closest('th');
      heading.setAttribute('aria-sort', active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      button.dataset.direction = active ? state.direction : '';
    });
  }
  updateExpenseSortIndicators();
  expenseSortButtons.forEach((button) => button.addEventListener('click', () => {
    if (state.sort === button.dataset.sortColumn) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
    else {
      state.sort = button.dataset.sortColumn;
      state.direction = 'asc';
    }
    state.page = 1;
    updateExpenseSortIndicators();
    loadExpenses().catch((error) => showMessage(error.message, true));
  }));
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
  elements.pendingExpenseReviewBtn.addEventListener('click', openPendingExpenseReview);
  elements.approvePurchaseBtn.addEventListener('click', () => submitPurchaseReview('approve'));
  elements.rejectPurchaseBtn.addEventListener('click', () => submitPurchaseReview('reject'));
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
  document.querySelectorAll('[data-close-pending-review]').forEach((button) => button.addEventListener('click', () => closeModal(elements.pendingExpenseReviewModal)));
  document.querySelectorAll('[data-close-purchase-details]').forEach((button) => button.addEventListener('click', closePurchaseReviewDetails));
  [elements.expenseModal, elements.voidModal, elements.expenseHistoryModal, elements.pendingExpenseReviewModal, elements.pendingPurchaseDetailModal].forEach((modal) => {
    common.bindAccessibleModal(modal);
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      if (modal === elements.pendingPurchaseDetailModal) closePurchaseReviewDetails();
      else closeModal(modal);
    });
    if (modal === elements.pendingPurchaseDetailModal) {
      modal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          purchaseDetailRequest += 1;
          state.selectedPurchase = null;
        }
      });
    }
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
  refreshPendingPurchases().catch((error) => {
    markPendingPurchaseCountUnavailable(error);
    showMessage(`Pending purchase count could not be loaded: ${error.message}`, true);
  });
})();