// ContentManagement.html page-specific JS
// Renders 4 tabs: Services & Treatments, Homepage Content, Team Members, Testimonials.
// All data below is placeholder — replace with fetches to the backend once the
// content-management endpoints exist. Add/Edit/Delete/Publish are stubbed for now.

document.addEventListener('DOMContentLoaded', () => {
  const tabsWrap = document.getElementById('cmTabs');
  const addBtn = document.getElementById('cmAddBtn');
  if (!tabsWrap) return;

  const SECTION_LABELS = {
    services: 'Service',
    homepage: 'Homepage Block',
    team: 'Team Member',
    testimonials: 'Testimonial'
  };

  // ---------- placeholder data ----------

  const SERVICES = [
    { name: 'Hydrating Facial', category: 'Facial', price: '₱1,000 – ₱1,200', duration: '60 min', status: 'published' },
    { name: 'Skin Whitening', category: 'Facial', price: '₱1,600 – ₱1,800', duration: '90 min', status: 'published' },
    { name: 'Anti-Aging Therapy', category: 'Anti-Aging', price: '₱1,800 – ₱2,000', duration: '75 min', status: 'published' },
    { name: 'Laser Rejuvenation', category: 'Laser', price: '₱3,200 – ₱3,500', duration: '90 min', status: 'published' },
    { name: 'Chemical Peel', category: 'Facial', price: '₱800 – ₱900', duration: '45 min', status: 'draft' },
    { name: 'Microdermabrasion', category: 'Exfoliation', price: '₱1,400 – ₱1,500', duration: '50 min', status: 'published' }
  ];

  const HOMEPAGE_BLOCKS = [
    { label: 'Hero Section', detail: 'Headline, lede text, and CTA buttons shown at the top of the homepage.', status: 'published' },
    { label: 'Services Strip', detail: 'The 4-column quick-glance row directly under the hero.', status: 'published' },
    { label: 'Featured Treatments Carousel', detail: 'Scrolling card list of highlighted treatments.', status: 'published' },
    { label: "Why Skin Goddess", detail: 'Two-column section with the clinic\u2019s value points.', status: 'published' },
    { label: 'Subscribe / Newsletter Banner', detail: 'Email signup section near the footer.', status: 'draft' }
  ];

  const TEAM = [
    { name: 'Dr. Sofia Reyes', role: 'Lead Dermatologist', specialty: 'Anti-Aging, Laser', status: 'published' },
    { name: 'Dr. Jenna Cruz', role: 'Aesthetician', specialty: 'Facials, Peels', status: 'published' },
    { name: 'Dr. Maria Lim', role: 'Aesthetician', specialty: 'Whitening, Exfoliation', status: 'published' },
    { name: 'Rica Lozano', role: 'Front Desk / Client Care', specialty: '—', status: 'draft' }
  ];

  const TESTIMONIALS_STATE = { items: [] };

  // ---------- helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function statusBadge(status) {
    const labels = { published: 'PUBLISHED', draft: 'DRAFT', pending: 'PENDING REVIEW' };
    return el('span', 'cm-status cm-status--' + status, labels[status] || status.toUpperCase());
  }

  function actionCell(section, itemLabel, extra) {
    const td = el('td');
    const wrap = el('div', 'cm-actions');
    const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
    editBtn.type = 'button';
    editBtn.dataset.section = section;
    editBtn.dataset.action = 'edit';
    editBtn.dataset.label = itemLabel;
    const secondBtn = el('button', 'apt-action', extra || 'Unpublish');
    secondBtn.type = 'button';
    secondBtn.dataset.section = section;
    secondBtn.dataset.action = 'toggle';
    secondBtn.dataset.label = itemLabel;
    wrap.appendChild(editBtn);
    wrap.appendChild(secondBtn);
    td.appendChild(wrap);
    return td;
  }

  // ---------- renderers ----------

  function renderServices() {
    const tbody = document.getElementById('cmServicesBody');
    tbody.textContent = '';
    SERVICES.forEach((s) => {
      const tr = el('tr');
      tr.appendChild(el('td', '', s.name));
      tr.appendChild(el('td', '', s.category));
      tr.appendChild(el('td', '', s.price));
      tr.appendChild(el('td', '', s.duration));
      const statusTd = el('td');
      statusTd.appendChild(statusBadge(s.status));
      tr.appendChild(statusTd);
      tr.appendChild(actionCell('services', s.name, s.status === 'published' ? 'Unpublish' : 'Publish'));
      tbody.appendChild(tr);
    });
  }

  function renderHomepage() {
    const list = document.getElementById('cmHomepageList');
    list.textContent = '';
    HOMEPAGE_BLOCKS.forEach((b) => {
      const row = el('div', 'cm-block-row');
      const info = el('div', 'cm-block-info');
      info.appendChild(el('p', 'cm-block-label', b.label));
      info.appendChild(el('p', 'cm-block-detail', b.detail));
      row.appendChild(info);
      row.appendChild(statusBadge(b.status));
      const actions = el('div', 'cm-actions');
      const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
      editBtn.type = 'button';
      editBtn.dataset.section = 'homepage';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.label = b.label;
      actions.appendChild(editBtn);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function renderTeam() {
    const tbody = document.getElementById('cmTeamBody');
    tbody.textContent = '';
    TEAM.forEach((t) => {
      const tr = el('tr');
      tr.appendChild(el('td', '', t.name));
      tr.appendChild(el('td', '', t.role));
      tr.appendChild(el('td', '', t.specialty));
      const statusTd = el('td');
      statusTd.appendChild(statusBadge(t.status));
      tr.appendChild(statusTd);
      tr.appendChild(actionCell('team', t.name, t.status === 'published' ? 'Unpublish' : 'Publish'));
      tbody.appendChild(tr);
    });
  }

  function renderTestimonials() {
    const tbody = document.getElementById('cmTestimonialsBody');
    tbody.textContent = '';
    if (TESTIMONIALS_STATE.items.length === 0) {
      const tr = el('tr');
      const td = el('td', 'cm-feedback', 'No ratings yet.');
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    TESTIMONIALS_STATE.items.forEach((r) => {
      const tr = el('tr');
      tr.appendChild(el('td', '', r.client_name || 'Client'));
      tr.appendChild(el('td', '', r.service_name));
      tr.appendChild(el('td', '', '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)));
      tr.appendChild(el('td', 'cm-feedback', r.comment || '—'));
      const statusTd = el('td');
      statusTd.appendChild(statusBadge(r.is_public ? 'published' : 'pending'));
      tr.appendChild(statusTd);
      tr.appendChild(testimonialActionCell(r));
      tbody.appendChild(tr);
    });
  }

  function testimonialActionCell(rating) {
    const td = el('td');
    const wrap = el('div', 'cm-actions');
    const toggleBtn = el('button', 'apt-action', rating.is_public ? 'Hide' : 'Approve');
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      try {
        const response = await fetch(`/api/ratings/${rating.rating_id}/public`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPublic: !rating.is_public })
        });
        if (!response.ok) throw new Error('Could not update testimonial.');
        await loadTestimonials();
      } catch (error) {
        toggleBtn.disabled = false;
      }
    });
    wrap.appendChild(toggleBtn);
    td.appendChild(wrap);
    return td;
  }

  async function loadTestimonials() {
    try {
      const response = await fetch('/api/ratings/admin');
      if (!response.ok) throw new Error('Could not load testimonials.');
      TESTIMONIALS_STATE.items = await response.json();
    } catch (error) {
      TESTIMONIALS_STATE.items = [];
    }
    renderTestimonials();
  }

  renderServices();
  renderHomepage();
  renderTeam();
  loadTestimonials();

  // ---------- tab switching ----------

  tabsWrap.addEventListener('click', (event) => {
    const tab = event.target.closest('.um-tab');
    if (!tab) return;
    const section = tab.dataset.section;

    tabsWrap.querySelectorAll('.um-tab').forEach((t) => t.classList.toggle('um-tab--active', t === tab));
    document.querySelectorAll('.cm-panel').forEach((panel) => panel.classList.remove('cm-panel--active'));
    const panel = document.getElementById('cmPanel' + section.charAt(0).toUpperCase() + section.slice(1));
    if (panel) panel.classList.add('cm-panel--active');

    if (addBtn) addBtn.textContent = '+ Add ' + SECTION_LABELS[section];
  });

  if (addBtn) addBtn.textContent = '+ Add ' + SECTION_LABELS.services;
});