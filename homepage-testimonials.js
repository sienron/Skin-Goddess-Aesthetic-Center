(function () {
  const list = document.getElementById('testimonialsList');
  if (!list) return;

  let visibleTestimonials = [];
  let renderedColumnCount = 0;

  function getColumnCount() {
    if (window.matchMedia('(max-width: 700px)').matches) return 1;
    if (window.matchMedia('(max-width: 1240px)').matches) return 2;
    return 3;
  }

  function createCard(item) {
    const entry = document.createElement('article');
    entry.className = 'testimonial-entry';

    const comment = document.createElement('p');
    comment.className = 'testimonial-card__comment';
    comment.textContent = item.comment;

    const card = document.createElement('div');
    card.className = 'testimonial-card';

    const rating = Number(item.rating);
    let stars;
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      stars = document.createElement('p');
      stars.className = 'testimonial-card__rating';
      stars.setAttribute('role', 'img');
      stars.setAttribute('aria-label', `Rated ${rating} out of 5 stars`);
      stars.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    }

    const source = document.createElement('p');
    source.className = 'testimonial-card__source';
    source.textContent = item.source === 'Facebook'
      ? 'Facebook review'
      : item.service ? `Website review · ${item.service}` : 'Website review';
    card.append(comment, source);
    if (stars) card.appendChild(stars);

    const author = document.createElement('div');
    author.className = 'testimonial-author';

    const initial = document.createElement('span');
    initial.className = 'testimonial-author__initial';
    initial.textContent = (item.client || 'C').trim().charAt(0).toUpperCase();
    initial.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'testimonial-author__details';

    const client = document.createElement('p');
    client.className = 'testimonial-author__name';
    client.textContent = item.client || 'Client';

    details.appendChild(client);
    author.append(initial, details);
    entry.append(card, author);
    return entry;
  }

  function renderTestimonials(testimonials) {
    visibleTestimonials = testimonials.slice(0, 10);
    if (!visibleTestimonials.length) {
      list.replaceChildren();
      renderedColumnCount = 0;
      return;
    }

    const columnCount = getColumnCount();
    const columns = Array.from({ length: columnCount }, () => {
      const column = document.createElement('div');
      column.className = 'testimonial-column';
      return column;
    });

    visibleTestimonials.forEach((item, index) => {
      columns[index % columnCount].append(createCard(item));
    });

    const layout = document.createElement('div');
    layout.className = 'testimonial-columns';
    layout.append(...columns);
    list.replaceChildren(layout);
    renderedColumnCount = columnCount;
  }

  window.addEventListener('resize', () => {
    if (visibleTestimonials.length && getColumnCount() !== renderedColumnCount) {
      renderTestimonials(visibleTestimonials);
    }
  }, { passive: true });

  async function loadTestimonials() {
    try {
      const response = await fetch('/api/ratings/public');
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const testimonials = await response.json();
      if (!Array.isArray(testimonials)) throw new Error('Testimonial response was not a list');
      renderTestimonials(testimonials);
    } catch (error) {
      console.warn('Could not load public testimonials:', error.message);
      list.replaceChildren();
    }
  }

  loadTestimonials();
})();
