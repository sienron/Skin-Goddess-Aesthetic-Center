// ContentManagement.html page-specific JS

document.addEventListener('DOMContentLoaded', () => {
  const tabsWrap = document.getElementById('cmTabs');
  const addBtn = document.getElementById('cmAddBtn');
  if (!tabsWrap) return;
  const editor = document.getElementById('cmEditorDialog');
  const editorForm = document.getElementById('cmEditorForm');
  const editorFields = document.getElementById('cmEditorFields');
  const editorTitle = document.getElementById('cmEditorTitle');
  const editorError = document.getElementById('cmEditorError');
  const notice = document.getElementById('cmNotice');
  let activeSection = 'services';
  let editing = null;
  let selectedServiceCategory = 'all';
  let serviceSearchTerm = '';
  let selectedContentPage = 'home';

  const SECTION_LABELS = {
    services: 'Service',
    homepage: 'Homepage Block',
    announcements: 'Promo / Event',
    testimonials: 'Testimonial'
  };

  // ---------- placeholder data ----------

  let SERVICES = [];
  let HOMEPAGE_BLOCKS = [];
  let TEAM = [];
  let ANNOUNCEMENTS = [];
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

  function actionCell(section, itemId, isPublished) {
    const td = el('td');
    const wrap = el('div', 'cm-actions');
    const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
    editBtn.type = 'button';
    editBtn.dataset.section = section;
    editBtn.dataset.action = 'edit';
    editBtn.dataset.id = itemId;
    const secondBtn = el('button', 'apt-action', isPublished ? 'Unpublish' : 'Publish');
    secondBtn.type = 'button';
    secondBtn.dataset.section = section;
    secondBtn.dataset.action = 'toggle';
    secondBtn.dataset.id = itemId;
    wrap.appendChild(editBtn);
    wrap.appendChild(secondBtn);
    td.appendChild(wrap);
    return td;
  }

  // ---------- renderers ----------

  function formatMoney(value) {
    const amount = Number(value ?? 0);
    return `₱${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function renderServices() {
    const select = document.getElementById('cmServiceCategorySelect');
    const list = document.getElementById('cmServiceList');
    const searchInput = document.getElementById('cmServiceSearchInput');
    if (!select || !list) return;

    if (searchInput) {
      searchInput.value = serviceSearchTerm;
    }

    const categories = [...new Set(SERVICES.map((service) => service.category).filter(Boolean))].sort();
    if (!categories.length) {
      list.textContent = '';
      list.appendChild(el('p', 'cm-empty', 'No services found.'));
      return;
    }

    if (!categories.includes(selectedServiceCategory) || selectedServiceCategory === 'all' || !selectedServiceCategory) {
      selectedServiceCategory = categories[0];
    }

    select.innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join('');
    select.value = selectedServiceCategory;

    const normalizedQuery = serviceSearchTerm.trim().toLowerCase();
    const filteredServices = SERVICES.filter((service) => {
      const matchesCategory = selectedServiceCategory === 'all' || service.category === selectedServiceCategory;
      if (!matchesCategory) return false;

      if (!normalizedQuery) return true;

      const haystack = [
        service.service_name,
        service.category,
        service.description,
        service.duration_minutes,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });

    list.textContent = '';

    if (!filteredServices.length) {
      const emptyMessage = normalizedQuery ? 'No services match your search.' : 'No services found for this category.';
      list.appendChild(el('p', 'cm-empty', emptyMessage));
      return;
    }

    const scrollWrap = el('div', 'cm-category-scroll');
    filteredServices.forEach((service) => {
      const item = el('article', 'cm-service-item');
      const header = el('div', 'cm-service-header');
      const summary = el('div', 'cm-service-summary');
      const title = el('h3', 'cm-service-name', service.service_name);
      const pills = el('div', 'cm-service-pills');
      pills.appendChild(el('span', 'cm-mini-tag', service.category || 'General'));
      pills.appendChild(el('span', 'cm-mini-tag cm-mini-tag--muted', `${service.duration_minutes || 0} min`));
      summary.appendChild(title);
      summary.appendChild(pills);

      const price = el('div', 'cm-service-price', formatMoney(service.service_price));
      header.appendChild(summary);
      header.appendChild(price);

      const description = el('p', 'cm-service-description', service.description || 'No description available yet.');
      const footer = el('div', 'cm-service-footer');
      const meta = el('div', 'cm-service-meta');
      meta.appendChild(el('span', '', `Reservation fee: ${formatMoney(service.reservation_fee)}`));
      footer.appendChild(meta);

      const actions = el('div', 'cm-service-actions');
      const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
      editBtn.type = 'button';
      editBtn.dataset.section = 'services';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.id = service.service_id;
      const toggleBtn = actionButton(service.is_active ? 'Unpublish' : 'Publish', 'services', 'toggle', service.service_id);
      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      footer.appendChild(actions);

      const statusWrap = el('div', 'cm-service-status-row');
      statusWrap.appendChild(statusBadge(service.is_active ? 'published' : 'draft'));
      footer.appendChild(statusWrap);

      item.appendChild(header);
      item.appendChild(description);
      item.appendChild(footer);
      scrollWrap.appendChild(item);
    });

    list.appendChild(scrollWrap);
  }

  function renderHomepage() {
    const list = document.getElementById('cmHomepageList');
    const pageSelect = document.getElementById('cmPageSelect');
    if (!list) return;
    if (pageSelect) pageSelect.value = selectedContentPage;
    list.textContent = '';
    HOMEPAGE_BLOCKS.forEach((b) => {
      const card = el('article', 'cm-content-card');
      const previewImageUrl = selectedContentPage === 'home' && b.key === 'hero' ? '' : b.imageUrl;
      if (previewImageUrl) {
        const image = el('img', 'cm-content-card__image');
        image.src = previewImageUrl;
        image.alt = `${b.label} preview`;
        card.appendChild(image);
      } else {
        card.appendChild(el('div', 'cm-content-card__image cm-content-card__image--empty', 'No image'));
      }

      const info = el('div', 'cm-content-card__main');
      info.appendChild(el('p', 'cm-content-card__label', b.label));
      info.appendChild(el('h3', 'cm-content-card__title', b.title));
      if (b.body) info.appendChild(el('p', 'cm-content-card__body', b.body));
      card.appendChild(info);

      const controls = el('div', 'cm-content-card__controls');
      controls.appendChild(statusBadge(b.isPublished ? 'published' : 'draft'));
      const editorSection = b.editorSection || 'homepage';
      const itemId = b.editorSection === 'team' ? b.id : b.key;
      const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
      editBtn.type = 'button';
      editBtn.dataset.section = editorSection;
      editBtn.dataset.action = 'edit';
      editBtn.dataset.id = itemId;
      controls.appendChild(editBtn);
      controls.appendChild(actionButton(b.isPublished ? 'Unpublish' : 'Publish', editorSection, 'toggle', itemId));
      card.appendChild(controls);
      list.appendChild(card);
    });
    if (!HOMEPAGE_BLOCKS.length) list.appendChild(el('p', 'cm-empty', 'No content blocks found for this page.'));
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
      statusTd.appendChild(statusBadge(t.isPublished ? 'published' : 'draft'));
      tr.appendChild(statusTd);
      tr.appendChild(actionCell('team', t.id, t.isPublished));
      tbody.appendChild(tr);
    });
    if (!TEAM.length) tbody.appendChild(emptyRow(5, 'No team members found.'));
  }

  function renderTestimonials() {
    const tbody = document.getElementById('cmTestimonialsBody');
    tbody.textContent = '';
    if (TESTIMONIALS_STATE.items.length === 0) {
      tbody.appendChild(emptyRow(6, 'No testimonials yet.'));
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

  function renderAnnouncements() {
    const list = document.getElementById('cmAnnouncementList');
    if (!list) return;
    list.replaceChildren();
    ANNOUNCEMENTS.forEach((announcement) => {
      const card = el('article', 'cm-announcement-card');
      if (announcement.image_url) {
        const image = el('img', 'cm-announcement-card__image');
        image.src = announcement.image_url;
        image.alt = `${announcement.title} promo`;
        card.appendChild(image);
        card.classList.add('cm-announcement-card--with-image');
      }
      const details = el('div', 'cm-announcement-card__details');
      details.appendChild(el('p', 'cm-content-card__label', announcement.type.toUpperCase()));
      details.appendChild(el('h3', 'cm-content-card__title', announcement.title));
      details.appendChild(el('p', 'cm-content-card__body', announcement.message));

      const controls = el('div', 'cm-content-card__controls');
      controls.appendChild(statusBadge(announcement.is_published ? 'published' : 'draft'));
      const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
      editBtn.type = 'button';
      editBtn.dataset.section = 'announcements';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.id = announcement.announcement_id;
      controls.append(editBtn, actionButton(
        announcement.is_published ? 'Unpublish' : 'Publish',
        'announcements',
        'toggle',
        announcement.announcement_id
      ));
      const deleteBtn = actionButton('Delete', 'announcements', 'delete', announcement.announcement_id);
      controls.appendChild(deleteBtn);
      card.append(details, controls);
      list.appendChild(card);
    });
    if (!ANNOUNCEMENTS.length) list.appendChild(el('p', 'cm-empty', 'No promos or events yet.'));
  }

  async function loadAnnouncements() {
    ANNOUNCEMENTS = await apiRequest('/api/announcements/admin');
    renderAnnouncements();
  }

  function testimonialActionCell(rating) {
    const td = el('td');
    const wrap = el('div', 'cm-actions');
    const toggleBtn = el('button', 'apt-action', rating.is_public ? 'Hide' : 'Approve');
    toggleBtn.type = 'button';
    toggleBtn.dataset.section = 'testimonials';
    toggleBtn.dataset.action = 'toggle';
    toggleBtn.dataset.id = rating.rating_id;
    wrap.appendChild(toggleBtn);
    td.appendChild(wrap);
    return td;
  }

  async function loadTestimonials() {
    TESTIMONIALS_STATE.items = await apiRequest('/api/ratings/admin');
    renderTestimonials();
  }

  function emptyRow(colspan, message) {
    const row = el('tr');
    const cell = el('td', 'cm-empty', message);
    cell.colSpan = colspan;
    row.appendChild(cell);
    return row;
  }

  function actionButton(text, section, action, id) {
    const button = el('button', 'apt-action', text);
    button.type = 'button';
    button.dataset.section = section;
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Request failed (${response.status}).`);
    return data;
  }

  function setNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle('cm-notice--error', isError);
    notice.hidden = false;
    window.clearTimeout(setNotice.timer);
    setNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 4000);
  }

  async function loadServices() {
    SERVICES = await apiRequest('/api/services/admin');
    renderServices();
  }

  async function loadHomepage() {
    HOMEPAGE_BLOCKS = await apiRequest(`/api/content/admin/pages/${selectedContentPage}`);
    if (selectedContentPage === 'services') {
      SERVICES = await apiRequest('/api/services/admin');
    }
    if (selectedContentPage === 'home') {
      const removedHomepageBlocks = new Set([
        'services_strip',
        'experience',
        'why_skin_goddess',
      ]);
      HOMEPAGE_BLOCKS = HOMEPAGE_BLOCKS.filter((block) => !removedHomepageBlocks.has(block.key));
    }
    if (selectedContentPage === 'about') {
      TEAM = await apiRequest('/api/content/admin/team');
      HOMEPAGE_BLOCKS.push(...TEAM.map((member) => ({
        ...member,
        key: `team_member_${member.id}`,
        label: 'Specialist',
        title: member.name,
        body: member.role,
        imageUrl: member.photoUrl,
        editorSection: 'team',
      })));
    }
    renderHomepage();
  }

  async function loadTeam() {
    TEAM = await apiRequest('/api/content/admin/team');
  }

  async function refreshSection(section) {
    try {
      if (section === 'services') await loadServices();
      if (section === 'homepage') await loadHomepage();
      if (section === 'announcements') await loadAnnouncements();
      if (section === 'team') {
        if (selectedContentPage === 'about') await loadHomepage();
        else await loadTeam();
      }
      if (section === 'testimonials') await loadTestimonials();
    } catch (error) {
      setNotice(error.message, true);
    }
  }

  function addEditorField(name, label, value, options = {}) {
    const fieldLabel = el('label', 'cm-editor__field', label);
    const field = options.multiline ? el('textarea', 'cm-editor__input') : el('input', 'cm-editor__input');
    field.name = name;
    field.value = value || '';
    field.required = Boolean(options.required);
    if (options.type) field.type = options.type;
    if (options.min !== undefined) field.min = String(options.min);
    if (options.step) field.step = options.step;
    if (options.maxLength) field.maxLength = options.maxLength;
    fieldLabel.appendChild(field);
    editorFields.appendChild(fieldLabel);
  }

  function addEditorCheckbox(name, label, checked) {
    const fieldLabel = el('label', 'cm-editor__checkbox');
    const field = el('input');
    field.type = 'checkbox';
    field.name = name;
    field.checked = Boolean(checked);
    fieldLabel.append(field, document.createTextNode(label));
    editorFields.appendChild(fieldLabel);
  }

  function addImageEditorField(item) {
    const fieldLabel = el('label', 'cm-editor__field', 'Replace image (JPG, PNG, or WebP, up to 5 MB)');
    const preview = el('img', 'cm-editor__image-preview');
    const imageUrl = item?.imageUrl || item?.image_url || item?.photoUrl || '';
    preview.alt = 'Selected image preview';
    preview.hidden = !imageUrl;
    if (imageUrl) preview.src = imageUrl;

    const field = el('input', 'cm-editor__input');
    field.type = 'file';
    field.name = 'imageFile';
    field.accept = 'image/jpeg,image/png,image/webp';
    field.addEventListener('change', () => {
      const file = field.files?.[0];
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });

    fieldLabel.append(preview, field);
    editorFields.appendChild(fieldLabel);
  }

  function readImageData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', () => reject(new Error('Could not read the selected image.')));
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB.');
    const imageData = await readImageData(file);
    const result = await apiRequest('/api/content/admin/upload-image', {
      method: 'POST',
      body: JSON.stringify({ imageData }),
    });
    return result.imageUrl;
  }

  function openEditor(section, item) {
    editing = {
      section,
      id: item?.service_id || item?.announcement_id || item?.id || item?.key || null,
      pageKey: selectedContentPage,
      imageUrl: item?.imageUrl || item?.image_url || '',
      payload: item?.payload || {},
    };
    editorFields.textContent = '';
    editorError.hidden = true;
    editorError.textContent = '';
    editorTitle.textContent = `${item ? 'Edit' : 'Add'} ${SECTION_LABELS[section]}`;

    if (section === 'services') {
      addEditorField('serviceName', 'Service name', item?.service_name, { required: true, maxLength: 255 });
      addEditorField('category', 'Category', item?.category, { required: true, maxLength: 255 });
      addEditorField('description', 'Description', item?.description, { multiline: true, maxLength: 2000 });
      addEditorField('durationMinutes', 'Duration (minutes)', item?.duration_minutes, { type: 'number', required: true, min: 1, step: '1' });
      addEditorField('servicePrice', 'Service price (PHP)', item?.service_price, { type: 'number', required: true, min: 0.01, max: 999999, step: '0.01' });
      addEditorField('reservationFee', 'Reservation fee (PHP)', item?.reservation_fee, { type: 'number', required: true, min: 0.01, step: '0.01' });
    } else if (section === 'team') {
      addEditorField('name', 'Name', item?.name, { required: true, maxLength: 160 });
      addEditorField('role', 'Role', item?.role, { required: true, maxLength: 160 });
      addEditorField('specialty', 'Specialty', item?.specialty, { multiline: true, maxLength: 500 });
      addEditorField('experience', 'Experience', item?.experience, { multiline: true, maxLength: 500 });
      addImageEditorField(item);
      addEditorField('sortOrder', 'Display order', item?.sortOrder ?? TEAM.length, { type: 'number', required: true, min: 0, step: '1' });
    } else if (section === 'announcements') {
      const typeLabel = el('label', 'cm-editor__field', 'Type');
      const typeSelect = el('select', 'cm-editor__input');
      typeSelect.name = 'type';
      typeSelect.required = true;
      [
        ['promo', 'Promo'],
        ['deal', 'Deal'],
        ['event', 'Event'],
        ['announcement', 'Announcement'],
      ].forEach(([value, label]) => {
        const option = el('option', '', label);
        option.value = value;
        typeSelect.appendChild(option);
      });
      typeSelect.value = item?.type || 'promo';
      typeLabel.appendChild(typeSelect);
      editorFields.appendChild(typeLabel);
      addEditorField('title', 'Title', item?.title, { required: true, maxLength: 160 });
      addEditorField('message', 'Details', item?.message, { required: true, multiline: true, maxLength: 2000 });
      addImageEditorField(item);
      addEditorField('startsAt', 'Starts at (optional)', item?.starts_at ? new Date(item.starts_at).toISOString().slice(0, 16) : '', { type: 'datetime-local' });
      addEditorField('endsAt', 'Ends at (optional)', item?.ends_at ? new Date(item.ends_at).toISOString().slice(0, 16) : '', { type: 'datetime-local' });
      addEditorCheckbox('isPublished', 'Publish to customer pages', item?.is_published ?? true);
    } else if (section === 'homepage') {
      addEditorField('title', 'Title', item.title, { required: true, maxLength: 500, multiline: item.key === 'hero' });
      addEditorField('body', 'Supporting text', item.body, { multiline: true, maxLength: 2000 });
      if (item.payload?.category) {
        const categoryServices = SERVICES.filter((service) => service.category === item.payload.category);
        if (categoryServices.length) {
          editorFields.appendChild(el('p', 'cm-editor__section-title', 'Service prices shown on the Services page'));
          categoryServices.forEach((service) => {
            addEditorField(
              `categoryPrice_${service.service_id}`,
              service.service_name,
              service.service_price,
              { type: 'number', required: true, min: 0.01, max: 999999, step: '0.01' }
            );
          });
          editing.category = item.payload.category;
          editing.categoryServiceIds = categoryServices.map((service) => service.service_id);
        }
      }
      if (['hero', 'treatments_intro', 'newsletter'].includes(item.key)) {
        addEditorField('eyebrow', 'Eyebrow text', item.payload?.eyebrow, { maxLength: 160 });
      }
      if (item.key !== 'hero' && (item.imageUrl || item.payload?.category || item.key.startsWith('home_feature_') || item.key.startsWith('home_treatment_'))) {
        addImageEditorField(item);
      }
    }

    editor.showModal();
  }

  function closeEditor() {
    if (editor.open) editor.close();
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editorForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(editorForm).entries());
    const number = (field) => Number(values[field]);

    let url;
    let method;
    let payload;
    if (editing.section === 'services') {
      url = editing.id ? `/api/services/${editing.id}` : '/api/services';
      method = editing.id ? 'PUT' : 'POST';
      payload = {
        serviceName: values.serviceName,
        category: values.category,
        description: values.description,
        durationMinutes: number('durationMinutes'),
        servicePrice: number('servicePrice'),
        reservationFee: number('reservationFee'),
      };
    } else if (editing.section === 'team') {
      url = editing.id ? `/api/content/admin/team/${editing.id}` : '/api/content/admin/team';
      method = editing.id ? 'PUT' : 'POST';
      payload = {
        name: values.name,
        role: values.role,
        specialty: values.specialty,
        experience: values.experience,
        photoUrl: editing.imageUrl,
        sortOrder: number('sortOrder'),
      };
    } else if (editing.section === 'announcements') {
      url = editing.id ? `/api/announcements/admin/${editing.id}` : '/api/announcements/admin';
      method = editing.id ? 'PUT' : 'POST';
      payload = {
        type: values.type,
        title: values.title,
        message: values.message,
        imageUrl: editing.imageUrl,
        startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
        endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
        isPublished: values.isPublished === 'on',
      };
    } else {
      const block = HOMEPAGE_BLOCKS.find((item) => item.key === editing.id);
      url = `/api/content/admin/pages/${editing.pageKey}/${editing.id}`;
      method = 'PUT';
      const contentPayload = { ...editing.payload };
      if (Object.hasOwn(values, 'eyebrow')) contentPayload.eyebrow = values.eyebrow;
      payload = {
        title: values.title,
        body: values.body,
        imageUrl: editing.imageUrl,
        isPublished: block?.isPublished ?? true,
        payload: contentPayload,
      };
      if (editing.category && editing.categoryServiceIds?.length) {
        payload.categoryPrices = editing.categoryServiceIds.map((serviceId) => ({
          serviceId,
          servicePrice: number(`categoryPrice_${serviceId}`),
        }));
      }
    }

    const submit = editorForm.querySelector('[type="submit"]');
    submit.disabled = true;
    editorError.hidden = true;
    try {
      if (editing.section === 'homepage' || editing.section === 'team' || editing.section === 'announcements') {
        const selectedImage = editorForm.elements.namedItem('imageFile')?.files?.[0];
        if (selectedImage) {
          editing.imageUrl = await uploadImage(selectedImage);
          if (editing.section === 'team') payload.photoUrl = editing.imageUrl;
          else payload.imageUrl = editing.imageUrl;
        }
      }
      const categoryPrices = payload.categoryPrices;
      if (categoryPrices) {
        delete payload.categoryPrices;
        await apiRequest('/api/services/category-prices', {
          method: 'PUT',
          body: JSON.stringify({ category: editing.category, prices: categoryPrices }),
        });
      }
      await apiRequest(url, { method, body: JSON.stringify(payload) });
      closeEditor();
      setNotice('Changes saved.');
      await refreshSection(editing.section);
    } catch (error) {
      editorError.textContent = error.message;
      editorError.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function toggleItem(section, id) {
    if (section === 'services') {
      const item = SERVICES.find((service) => String(service.service_id) === String(id));
      await apiRequest(`/api/services/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.is_active }) });
    } else if (section === 'team') {
      const item = TEAM.find((member) => String(member.id) === String(id));
      await apiRequest(`/api/content/admin/team/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isPublished: !item.isPublished }) });
    } else if (section === 'announcements') {
      const item = ANNOUNCEMENTS.find((announcement) => String(announcement.announcement_id) === String(id));
      await apiRequest(`/api/announcements/admin/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !item.is_published }),
      });
    } else if (section === 'homepage') {
      const item = HOMEPAGE_BLOCKS.find((block) => block.key === id);
      await apiRequest(`/api/content/admin/pages/${selectedContentPage}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: item.title, body: item.body, imageUrl: item.imageUrl, payload: item.payload, isPublished: !item.isPublished }),
      });
    } else {
      const item = TESTIMONIALS_STATE.items.find((rating) => String(rating.rating_id) === String(id));
      await apiRequest(`/api/ratings/${id}/public`, { method: 'PATCH', body: JSON.stringify({ isPublic: !item.is_public }) });
    }
    await refreshSection(section);
    setNotice('Publication status updated.');
  }

  async function setActiveSection(section) {
    activeSection = section;
    addBtn.hidden = section === 'homepage' || section === 'testimonials';
    if (!addBtn.hidden) addBtn.textContent = '+ Add ' + SECTION_LABELS[section];
    await refreshSection(section);
  }

  const categorySelect = document.getElementById('cmServiceCategorySelect');
  categorySelect?.addEventListener('change', (event) => {
    selectedServiceCategory = event.target.value;
    renderServices();
  });

  document.getElementById('cmPageSelect')?.addEventListener('change', async (event) => {
    selectedContentPage = event.target.value;
    await refreshSection('homepage');
  });

  const searchInput = document.getElementById('cmServiceSearchInput');
  searchInput?.addEventListener('input', (event) => {
    serviceSearchTerm = event.target.value;
    renderServices();
  });

  document.getElementById('cmEditorClose').addEventListener('click', closeEditor);
  document.getElementById('cmEditorCancel').addEventListener('click', closeEditor);
  editorForm.addEventListener('submit', saveEditor);
  editor.addEventListener('click', (event) => {
    if (event.target === editor) closeEditor();
  });

  addBtn.addEventListener('click', () => openEditor(activeSection, null));
  document.querySelector('.cm-card').addEventListener('click', async (event) => {
    const tab = event.target.closest('.um-tab');
    if (tab) {
      const section = tab.dataset.section;
      tabsWrap.querySelectorAll('.um-tab').forEach((item) => item.classList.toggle('um-tab--active', item === tab));
      document.querySelectorAll('.cm-panel').forEach((panel) => panel.classList.remove('cm-panel--active'));
      document.getElementById('cmPanel' + section.charAt(0).toUpperCase() + section.slice(1))?.classList.add('cm-panel--active');
      await setActiveSection(section);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    const { section, id, action: actionName } = action.dataset;
    try {
      if (actionName === 'edit') {
        const items = section === 'services'
          ? SERVICES
          : section === 'team'
            ? TEAM
            : section === 'announcements'
              ? ANNOUNCEMENTS
              : HOMEPAGE_BLOCKS;
        const key = section === 'services'
          ? 'service_id'
          : section === 'team'
            ? 'id'
            : section === 'announcements'
              ? 'announcement_id'
              : 'key';
        const item = items.find((entry) => String(entry[key]) === String(id));
        if (item) openEditor(section, item);
      } else if (actionName === 'toggle') {
        action.disabled = true;
        await toggleItem(section, id);
      } else if (actionName === 'delete' && section === 'announcements') {
        if (!window.confirm('Delete this promo or event?')) return;
        await apiRequest(`/api/announcements/admin/${id}`, { method: 'DELETE' });
        await refreshSection('announcements');
        setNotice('Announcement deleted.');
      }
    } catch (error) {
      setNotice(error.message, true);
    } finally {
      action.disabled = false;
    }
  });

  setActiveSection('services');
});