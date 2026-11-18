(() => {
  const common = window.FinanceCommon;
  if (!common) return;
  const refs = {
    from: document.getElementById('reportFrom'),
    to: document.getElementById('reportTo'),
    message: document.getElementById('reportMessage')
  };
  const today = common.manilaToday();
  refs.from.value = common.monthStart(today);
  refs.to.value = today;
  const periods = common.bindPeriodControls({
    fromInput: refs.from,
    toInput: refs.to,
    buttons: document.querySelectorAll('[data-period]'),
    onChange(range) {
      window.FinanceReports?.load(range);
    },
    onInvalid(message) {
      window.FinanceReports?.invalidate(true);
      if (refs.message) refs.message.textContent = message;
    }
  });
  periods.setPeriod('month');
})();
