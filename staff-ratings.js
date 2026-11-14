(function () {
  const averageEl = document.getElementById('ratingsAverage');
  const starsEl = document.getElementById('ratingsSummaryStars');
  const countEl = document.getElementById('ratingsCount');
  const breakdownEl = document.getElementById('ratingsBreakdown');
  const reviewsList = document.getElementById('staffRatingsList');
  if (!averageEl || !starsEl || !countEl || !breakdownEl || !reviewsList) return;

  function formatDate(value, dateOnly = false) {
    const date = new Date(dateOnly ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
  }

  function appendBreakdown(breakdown, total) {
    breakdownEl.replaceChildren();
    for (let rating = 5; rating >= 1; rating -= 1) {
      const count = Number(breakdown[rating]) || 0;
      const row = document.createElement('div');
      row.className = 'rating-breakdown-row';

      const label = document.createElement('span');
      label.className = 'rating-breakdown-label';
      label.textContent = `${rating} ★`;

      const track = document.createElement('div');
      track.className = 'rating-breakdown-track';
      const fill = document.createElement('div');
      fill.className = 'rating-breakdown-fill';
      fill.style.width = `${total ? (count / total) * 100 : 0}%`;
      track.appendChild(fill);

      const countLabel = document.createElement('span');
      countLabel.className = 'rating-breakdown-count';
      countLabel.textContent = String(count);
      row.append(label, track, countLabel);
      breakdownEl.appendChild(row);
    }
  }

  function renderReview(review) {
    const article = document.createElement('article');
    article.className = 'staff-review-card';

    const header = document.createElement('div');
    header.className = 'staff-review-card__header';
    const client = document.createElement('h3');
    client.className = 'staff-review-card__client';
    client.textContent = review.client || 'Customer';

    const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
    const stars = document.createElement('span');
    stars.className = 'staff-review-card__rating';
    stars.textContent = `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`;
    stars.setAttribute('aria-label', `${rating} out of 5 stars`);
    header.append(client, stars);

    const meta = document.createElement('div');
    meta.className = 'staff-review-card__meta';
    const service = document.createElement('span');
    service.className = 'staff-review-card__service';
    service.textContent = review.service || 'Completed service';
    const dates = document.createElement('span');
    dates.className = 'staff-review-card__dates';
    dates.textContent = `Appointment ${formatDate(review.appointmentDate, true)} · Reviewed ${formatDate(review.createdAt)}`;
    meta.append(service, dates);

    const comment = document.createElement('p');
    comment.className = 'staff-review-card__comment';
    comment.textContent = review.comment || (review.isAutomatic
      ? 'No written comment was submitted for this appointment.'
      : 'No written comment provided.');

    article.append(header, meta, comment);
    return article;
  }

  function renderStatus(kind, title, detail) {
    const status = document.createElement('div');
    status.className = `staff-ratings-status staff-ratings-status--${kind}`;
    if (kind === 'error') status.setAttribute('role', 'alert');

    const heading = document.createElement('h3');
    heading.textContent = title;
    const message = document.createElement('p');
    message.textContent = detail;
    status.append(heading, message);
    return status;
  }

  async function loadRatings() {
    try {
      const response = await fetch('/api/ratings/mine/reviews', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : {};

      if (!response.ok) {
        const message = typeof data.message === 'string' && data.message.trim()
          ? data.message
          : response.status === 404
            ? 'The ratings endpoint is not available on this server yet. Restart or redeploy the app, then reload this page.'
            : `The ratings request failed (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!isJson) {
        throw new Error(`The ratings service returned an unexpected response (HTTP ${response.status}).`);
      }

      const total = Number(data.totalReviews) || 0;
      const average = Number(data.average) || 0;
      averageEl.textContent = total ? average.toFixed(1) : '—';
      countEl.textContent = `${total} review${total === 1 ? '' : 's'}`;
      const filledStars = total ? Math.round(average) : 0;
      starsEl.textContent = `${'★'.repeat(filledStars)}${'☆'.repeat(5 - filledStars)}`;
      starsEl.setAttribute('aria-label', total ? `${average.toFixed(1)} out of 5 stars` : 'No ratings yet');
      appendBreakdown(data.breakdown || {}, total);

      reviewsList.replaceChildren();
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (!reviews.length) {
        reviewsList.appendChild(renderStatus(
          'empty',
          'No ratings yet',
          'Customer reviews for your completed appointments will appear here.',
        ));
        return;
      }
      reviews.forEach((review) => reviewsList.appendChild(renderReview(review)));
    } catch (error) {
      console.error('Unable to load aesthetician ratings:', error);
      averageEl.textContent = '—';
      countEl.textContent = 'Ratings could not be loaded.';
      starsEl.textContent = '☆☆☆☆☆';
      appendBreakdown({}, 0);
      const detail = error instanceof Error
        ? error.message
        : 'An unexpected error occurred while loading ratings.';
      reviewsList.replaceChildren(renderStatus('error', 'Ratings unavailable', detail));
    }
  }

  loadRatings();
})();
