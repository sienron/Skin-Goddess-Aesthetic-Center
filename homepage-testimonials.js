/* Homepage "Client Stories" section: pulls admin-approved testimonials from
   /api/ratings/public. Falls back to the static markup already in the page
   when there are no approved testimonials yet or the request fails. */
(function () {
  const grid = document.getElementById('feedbackGrid');
  if (!grid) return;

  function starString(rating) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'feedback-grid-item';

    const body = document.createElement('p');
    body.className = 'feedback-grid-item-body';
    body.textContent = item.comment;

    const footer = document.createElement('div');
    footer.className = 'feedback-grid-items-footer';

    const dash = document.createElement('span');
    dash.className = 'feedback-grid-item-dash';

    const person = document.createElement('p');
    person.className = 'feedback-grid-item-person';
    person.textContent = item.client;

    const service = document.createElement('span');
    service.className = 'feedback-grid-item-service';
    service.textContent = item.service;

    const stars = document.createElement('div');
    stars.className = 'feedback-grid-item-stars';
    stars.textContent = starString(item.rating);

    footer.append(dash, person, service, stars);
    card.append(body, footer);
    return card;
  }

  async function loadTestimonials() {
    try {
      const response = await fetch('/api/ratings/public');
      if (!response.ok) return;
      const testimonials = await response.json();
      if (!Array.isArray(testimonials) || testimonials.length === 0) return;
      grid.replaceChildren(...testimonials.slice(0, 3).map(buildCard));
    } catch (error) {
      // Keep the static fallback content already in the page.
    }
  }

  loadTestimonials();
})();
