(() => {
  const common = window.FinanceCommon;
  const pendingCount = document.getElementById('dashPendingExpenseReviews');
  const pendingDetails = document.getElementById('dashPendingExpenseReviewDetails');
  const closingStatus = document.getElementById('dashCashClosingStatus');
  const closingDetails = document.getElementById('dashCashClosingDetails');
  if (!common || !pendingCount || !pendingDetails || !closingStatus || !closingDetails) return;

  async function loadPendingReviews() {
    try {
      const suggestions = await common.fetchJson('/api/finance/inventory-purchase-suggestions');
      if (!Array.isArray(suggestions)) throw new Error('Pending review data is unavailable.');
      pendingCount.textContent = String(suggestions.length);
      pendingDetails.textContent = 'Inventory purchase suggestions awaiting review';
    } catch (error) {
      pendingCount.textContent = 'Unavailable';
      pendingDetails.textContent = error.message || 'Could not load pending reviews.';
      console.error('Could not load pending finance reviews:', error);
    }
  }

  async function loadCashClosing() {
    try {
      const result = await common.fetchJson('/api/finance/cash-closing');
      if (!result || typeof result.business_date !== 'string') throw new Error('Cash closing data is unavailable.');
      closingStatus.textContent = result.closing ? 'Closed' : 'Not closed';
      const expected = common.formatPeso(result.expected_amount);
      if (result.closing) {
        closingDetails.textContent = `${result.business_date} | Expected ${expected} | Counted ${common.formatPeso(result.closing.actual_amount)}`;
      } else {
        closingDetails.textContent = `${result.business_date} | Expected ${expected}`;
      }
    } catch (error) {
      closingStatus.textContent = 'Unavailable';
      closingDetails.textContent = error.message || 'Could not load cash closing status.';
      console.error('Could not load finance cash closing status:', error);
    }
  }

  void Promise.all([loadPendingReviews(), loadCashClosing()]);
})();
