/* Shared staff rating widget: fetches the logged-in staff member's aggregate
   rating from /api/ratings/mine and renders stars + breakdown bars.
   Call loadRatingWidget(ids) with element ids for average/stars/count/breakdown,
   or just include this file — it auto-detects the sidebar and dashboard widgets. */
(function (global) {
  function renderStars(container, average) {
    container.replaceChildren();
    for (let i = 0; i < 5; i += 1) {
      const fillPercent = Math.max(0, Math.min(1, average - i)) * 100;

      const wrap = document.createElement('div');
      wrap.className = 'star-wrap';

      const bg = document.createElement('div');
      bg.className = 'star-bg';

      const fill = document.createElement('div');
      fill.className = 'star-fill';
      fill.style.width = `${fillPercent}%`;

      const fillInner = document.createElement('div');
      fillInner.className = 'star-fill-inner';

      fill.appendChild(fillInner);
      wrap.append(bg, fill);
      container.appendChild(wrap);
    }
  }

  function renderBreakdown(container, breakdown, totalReviews) {
    container.replaceChildren();
    for (let star = 5; star >= 1; star -= 1) {
      const count = breakdown[star] || 0;
      const percent = totalReviews > 0 ? (count / totalReviews) * 100 : 0;

      const row = document.createElement('div');
      row.className = 'rating-breakdown-row';

      const label = document.createElement('span');
      label.className = 'rating-breakdown-label';
      label.textContent = `${star} ★`;

      const track = document.createElement('div');
      track.className = 'rating-breakdown-track';
      const fill = document.createElement('div');
      fill.className = 'rating-breakdown-fill';
      fill.style.width = `${percent}%`;
      track.appendChild(fill);

      const countEl = document.createElement('span');
      countEl.className = 'rating-breakdown-count';
      countEl.textContent = count;

      row.append(label, track, countEl);
      container.appendChild(row);
    }
  }

  async function loadRatingWidget(ids) {
    const averageEl = document.getElementById(ids.average);
    const starsEl = document.getElementById(ids.stars);
    const countEl = document.getElementById(ids.count);
    const breakdownEl = document.getElementById(ids.breakdown);
    if (!averageEl || !starsEl || !countEl || !breakdownEl) return;

    try {
      const response = await fetch('/api/ratings/mine');
      if (!response.ok) throw new Error('Could not load ratings.');
      const data = await response.json();
      const totalReviews = data.totalReviews || 0;

      averageEl.textContent = totalReviews > 0 ? Number(data.average).toFixed(1) : '—';
      countEl.textContent = totalReviews > 0 ? `from ${totalReviews} client review${totalReviews === 1 ? '' : 's'}` : 'No reviews yet';
      renderStars(starsEl, totalReviews > 0 ? Number(data.average) : 0);
      renderBreakdown(breakdownEl, data.breakdown || {}, totalReviews);
    } catch (error) {
      averageEl.textContent = '—';
      countEl.textContent = 'Could not load reviews.';
      starsEl.replaceChildren();
      breakdownEl.replaceChildren();
    }
  }

  global.loadRatingWidget = loadRatingWidget;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ratingAverage')) {
      loadRatingWidget({ average: 'ratingAverage', stars: 'ratingStars', count: 'ratingReviewCount', breakdown: 'ratingBreakdown' });
    }
    if (document.getElementById('dashboardRatingAverage')) {
      loadRatingWidget({ average: 'dashboardRatingAverage', stars: 'dashboardRatingStars', count: 'dashboardRatingCount', breakdown: 'dashboardRatingBreakdown' });
    }
  });
})(window);
