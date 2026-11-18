(() => {
  const common = window.FinanceCommon;
  if (!common) return;
  const refs = {
    from: document.getElementById('reportFrom'),
    to: document.getElementById('reportTo'),
    message: document.getElementById('reportMessage'),
    direction: document.getElementById('recordExportDirection'),
    classification: document.getElementById('recordExportClassification'),
    method: document.getElementById('recordExportMethod'),
    source: document.getElementById('recordExportSource'),
    status: document.getElementById('recordExportStatus')
  };
  const today = common.manilaToday();
  refs.from.value = common.monthStart(today);
  refs.to.value = today;
  const periods = common.bindPeriodControls({
    fromInput: refs.from,
    toInput: refs.to,
    buttons: document.querySelectorAll('[data-period]'),
    onChange() {
      if (refs.message) refs.message.textContent = '';
    },
    onInvalid(message) {
      if (refs.message) refs.message.textContent = message;
    }
  });
  periods.setPeriod('month');

  function exportUrl(kind) {
    if (!common.isValidRange(refs.from.value, refs.to.value)) {
      if (refs.message) {
        refs.message.textContent = 'Choose a valid date range with the start date on or before the end date.';
      }
      return null;
    }
    const params = new URLSearchParams();
    if (refs.from.value) params.set('from', refs.from.value);
    if (refs.to.value) params.set('to', refs.to.value);
    const direction = refs.direction.value;
    const classification = refs.classification.value.trim();
    const method = refs.method.value.trim();
    const source = refs.source.value;
    const status = refs.status.value;

    if (kind === 'cash-closings') return `/api/finance/cash-closing/export.xlsx?${params}`;
    if (kind === 'income') {
      params.set('direction', 'money_in');
      params.set('source', 'payments');
      params.set('status', 'posted');
    } else if (kind === 'expenses') {
      params.set('direction', 'money_out');
      params.set('source', 'expenses');
      if (status !== 'all') params.set('status', status);
    } else if (kind === 'payments') {
      params.set('direction', 'money_in');
      params.set('source', 'payments');
      if (status !== 'all') params.set('status', status);
    } else {
      if (direction !== 'all') params.set('direction', direction);
      if (source !== 'all') params.set('source', source);
      if (status !== 'all') params.set('status', status);
    }

    if (classification) params.set('classification', classification);
    if (method) params.set('method', method);
    return `/api/finance/ledger/export.xlsx?${params}`;
  }

  document.querySelectorAll('[data-finance-record-export]').forEach((button) => {
    button.addEventListener('click', () => {
      const url = exportUrl(button.dataset.financeRecordExport);
      if (url) window.location.href = url;
    });
  });
})();
