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

  const SECTION_LABELS = {
    services: 'Service',
    homepage: 'Homepage Block',
    team: 'Team Member',
    testimonials: 'Testimonial'
  };

  // ---------- placeholder data ----------

  let SERVICES = [];
  let HOMEPAGE_BLOCKS = [];
  let TEAM = [];
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

  function renderServices() {
    const tbody = document.getElementById('cmServicesBody');
    tbody.textContent = '';
    SERVICES.forEach((s) => {
      const tr = el('tr');
      tr.appendChild(el('td', '', s.service_name));
      tr.appendChild(el('td', '', s.category));
      tr.appendChild(el('td', '', `₱${Number(s.service_price).toLocaleString()}`));
      tr.appendChild(el('td', '', `${s.duration_minutes} min`));
      const statusTd = el('td');
      statusTd.appendChild(statusBadge(s.is_active ? 'published' : 'draft'));
      tr.appendChild(statusTd);
      tr.appendChild(actionCell('services', s.service_id, s.is_active));
      tbody.appendChild(tr);
    });
    if (!SERVICES.length) tbody.appendChild(emptyRow(6, 'No services found.'));
  }

  function renderHomepage() {
    const list = document.getElementById('cmHomepageList');
    list.textContent = '';
    HOMEPAGE_BLOCKS.forEach((b) => {
      const row = el('div', 'cm-block-row');
      const info = el('div', 'cm-block-info');
      info.appendChild(el('p', 'cm-block-label', b.label));
      info.appendChild(el('p', 'cm-block-detail', b.title));
      if (b.body) info.appendChild(el('p', 'cm-block-detail', b.body));
      row.appendChild(info);
      row.appendChild(statusBadge(b.is_published ? 'published' : 'draft'));
      const actions = el('div', 'cm-actions');
      const editBtn = el('button', 'apt-action apt-action--view', 'Edit');
      editBtn.type = 'button';
      editBtn.dataset.section = 'homepage';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.id = b.key;
      actions.appendChild(editBtn);
      actions.appendChild(actionButton(b.is_published ? 'Unpublish' : 'Publish', 'homepage', 'toggle', b.key));
      row.appendChild(actions);
      list.appendChild(row);
    });
    if (!HOMEPAGE_BLOCKS.length) list.appendChild(el('p', 'cm-empty', 'No homepage content found.'));
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
    HOMEPAGE_BLOCKS = await apiRequest('/api/content/admin/homepage');
    renderHomepage();
  }

  async function loadTeam() {
    TEAM = await apiRequest('/api/content/admin/team');
    renderTeam();
  }

  async function refreshSection(section) {
    try {
      if (section === 'services') await loadServices();
      if (section === 'homepage') await loadHomepage();
      if (section === 'team') await loadTeam();
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

  function openEditor(section, item) {
    editing = { section, id: item?.service_id || item?.id || item?.key || null };
    editorFields.textContent = '';
    editorError.hidden = true;
    editorError.textContent = '';
    editorTitle.textContent = `${item ? 'Edit' : 'Add'} ${SECTION_LABELS[section]}`;

    if (section === 'services') {
      addEditorField('serviceName', 'Service name', item?.service_name, { required: true, maxLength: 255 });
      addEditorField('category', 'Category', item?.category, { required: true, maxLength: 255 });
      addEditorField('description', 'Description', item?.description, { multiline: true, maxLength: 2000 });
      addEditorField('durationMinutes', 'Duration (minutes)', item?.duration_minutes, { type: 'number', required: true, min: 1, step: '1' });
      addEditorField('servicePrice', 'Price (PHP)', item?.service_price, { type: 'number', required: true, min: 0.01, step: '0.01' });
      addEditorField('reservationFee', 'Reservation fee (PHP)', item?.reservation_fee, { type: 'number', required: true, min: 0.01, step: '0.01' });
    } else if (section === 'team') {
      addEditorField('name', 'Name', item?.name, { required: true, maxLength: 160 });
      addEditorField('role', 'Role', item?.role, { required: true, maxLength: 160 });
      addEditorField('specialty', 'Specialty', item?.specialty, { multiline: true, maxLength: 500 });
      addEditorField('experience', 'Experience', item?.experience, { multiline: true, maxLength: 500 });
      addEditorField('photoUrl', 'Photo path (inside images/)', item?.photoUrl || 'images/SkinGoddessReceptionImg.jpg', { required: true, maxLength: 500 });
      addEditorField('sortOrder', 'Display order', item?.sortOrder ?? TEAM.length, { type: 'number', required: true, min: 0, step: '1' });
    } else if (section === 'homepage') {
      addEditorField('title', 'Title', item.title, { required: true, maxLength: 500 });
      addEditorField('body', 'Supporting text', item.body, { multiline: true, maxLength: 2000 });
      if (item.key === 'services_strip') {
        (item.payload?.items || []).forEach((stripItem, index) => {
          addEditorField(`stripTitle${index}`, `Service card ${index + 1} title`, stripItem.title, { required: true, maxLength: 160 });
          addEditorField(`stripBody${index}`, `Service card ${index + 1} text`, stripItem.body, { multiline: true, maxLength: 500 });
        });
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
        photoUrl: values.photoUrl,
        sortOrder: number('sortOrder'),
      };
    } else {
      const block = HOMEPAGE_BLOCKS.find((item) => item.key === editing.id);
      const stripItems = block?.key === 'services_strip'
        ? (block.payload?.items || []).map((item, index) => ({ title: values[`stripTitle${index}`], body: values[`stripBody${index}`] }))
        : undefined;
      url = `/api/content/admin/homepage/${editing.id}`;
      method = 'PUT';
      payload = {
        title: values.title,
        body: values.body,
        isPublished: block.is_published,
        ...(stripItems ? { payload: { items: stripItems } } : {}),
      };
    }

    const submit = editorForm.querySelector('[type="submit"]');
    submit.disabled = true;
    editorError.hidden = true;
    try {
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
    } else if (section === 'homepage') {
      const item = HOMEPAGE_BLOCKS.find((block) => block.key === id);
      await apiRequest(`/api/content/admin/homepage/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: item.title, body: item.body, payload: item.payload, isPublished: !item.is_published }),
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
        const items = section === 'services' ? SERVICES : section === 'team' ? TEAM : HOMEPAGE_BLOCKS;
        const key = section === 'services' ? 'service_id' : section === 'team' ? 'id' : 'key';
        const item = items.find((entry) => String(entry[key]) === String(id));
        if (item) openEditor(section, item);
      } else if (actionName === 'toggle') {
        action.disabled = true;
        await toggleItem(section, id);
      }
    } catch (error) {
      setNotice(error.message, true);
    } finally {
      action.disabled = false;
    }
  });

  setActiveSection('services');
});