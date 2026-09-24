// ============ USER MANAGEMENT PAGE — connected to /api/users ============
// Replaces the old hardcoded USERS_DATA demo with real fetch() calls to
// routes/users.js. Requires an active admin session (cookie), which the
// browser sends automatically since this page itself is behind requireRole('admin').

const PAGE_SIZE = 10;
let currentPage = 1;
let currentTab = 'ALL';     // maps to ?role=
let currentStatus = 'ALL';  // maps to ?status=
let currentSearch = '';
let editingUserId = null;
let editingUserCache = null; // last-fetched full record for the open modal, used by Cancel

// ---------- elements ----------
const tableBody = document.getElementById('umTableBody');
const tabsNav = document.getElementById('umTabs');
const searchInput = document.getElementById('umSearchInput');
const selectAll = document.getElementById('umSelectAll');
const showingText = document.getElementById('umShowingText');
const paginationNav = document.getElementById('umPagination');

// ---------- helpers ----------
function badgeClass(role) {
  return { admin: 'staff', client: 'client', aesthetician: 'doctor' }[role] || 'staff';
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // send the session cookie
    ...options,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.message) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// ---------- fetch + render table ----------
async function fetchUsers() {
  const params = new URLSearchParams({
    search: currentSearch,
    role: currentTab === 'SUSPENDED' ? 'ALL' : currentTab,
    status: currentTab === 'SUSPENDED' ? 'suspended' : currentStatus,
    page: currentPage,
    limit: PAGE_SIZE,
  });

  return apiRequest(`/api/users?${params.toString()}`);
}

function rowHTML(u) {
  const suspendAction = u.status === 'suspended'
    ? `<a href="#" class="um-action" data-action="restore" data-id="${u.id}">Restore</a>`
    : `<a href="#" class="um-action" data-action="edit" data-id="${u.id}">Edit</a>`;

  const statusCell = u.status === 'suspended'
    ? `<span class="um-status um-status--suspended">&bull; SUSPENDED</span>`
    : `<span class="um-status um-status--active">&bull; ACTIVE</span>`;

  return `
    <tr data-id="${u.id}" class="${u.status === 'suspended' ? 'um-row--muted' : ''}">
      <td><input type="checkbox" class="um-row-check"></td>
      <td class="um-user-cell">
        <span class="um-avatar um-avatar--sm ${u.status === 'suspended' ? 'um-avatar--muted' : ''}">${u.initials}</span>
        <span class="um-user-cell__info">
          <span class="um-user-cell__name">${u.fullName || '(no name)'}</span>
          <span class="um-user-cell__meta">USR-${String(u.id).padStart(5, '0')}${u.sex ? ' &middot; ' + u.sex.charAt(0).toUpperCase() : ''}</span>
        </span>
      </td>
      <td><span class="um-badge um-badge--${badgeClass(u.role)}">${u.roleLabel}</span></td>
      <td>${u.email}</td>
      <td>${formatDate(u.joined)}</td>
      <td class="um-visits"><span class="um-visits__count">—</span><span class="um-visits__label">not tracked yet</span></td>
      <td>—</td>
      <td>${statusCell}</td>
      <td class="um-actions">
        <a href="#" class="um-action um-action--view" data-action="view" data-id="${u.id}">View</a>
        ${suspendAction}
        <a href="#" class="um-action um-action--danger" data-action="delete" data-id="${u.id}">Del</a>
      </td>
    </tr>`;
}

async function renderTable() {
  tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#8a837a;">Loading…</td></tr>`;

  try {
    const { users, total } = await fetchUsers();
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    tableBody.innerHTML = users.length
      ? users.map(rowHTML).join('')
      : `<tr><td colspan="9" style="text-align:center; padding:24px; color:#8a837a;">No users match your search/filter.</td></tr>`;

    showingText.textContent = `Showing ${users.length} of ${total} users`;
    if (selectAll) selectAll.checked = false;
    renderPagination(totalPages);
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#9b2626;">${error.message}</td></tr>`;
  }
}

function renderPagination(totalPages) {
  let html = `<button type="button" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<button type="button" data-page="${p}" class="${p === currentPage ? 'active' : ''}">${p}</button>`;
  }
  html += `<button type="button" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  paginationNav.innerHTML = html;
}

async function renderStats() {
  try {
    const stats = await apiRequest('/api/users/stats');
    document.getElementById('statTotalUsers').textContent = stats.total;
    document.getElementById('statClients').textContent = stats.clients;
    document.getElementById('statStaff').textContent = stats.staff;
    document.getElementById('statSuspended').textContent = stats.suspended;
    document.getElementById('statTotalUsersHint').textContent = `${stats.total} total accounts`;
    document.getElementById('statSuspendedHint').textContent = `${stats.suspended} suspended account${stats.suspended === 1 ? '' : 's'}`;
  } catch (error) {
    console.error('Stats error:', error);
  }
}

function renderAll() {
  renderStats();
  renderTable();
}

// ---------- tabs ----------
if (tabsNav) {
  tabsNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.um-tab');
    if (!btn) return;
    tabsNav.querySelectorAll('.um-tab').forEach((t) => t.classList.remove('um-tab--active'));
    btn.classList.add('um-tab--active');
    currentTab = btn.dataset.role; // ALL | client | aesthetician | admin | SUSPENDED
    currentPage = 1;
    renderTable();
  });
}

// ---------- search (debounced) ----------
let searchDebounce;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentSearch = searchInput.value;
      currentPage = 1;
      renderTable();
    }, 300);
  });
}

// ---------- select all ----------
if (selectAll) {
  selectAll.addEventListener('change', () => {
    document.querySelectorAll('.um-row-check').forEach((cb) => { cb.checked = selectAll.checked; });
  });
}

// ---------- pagination clicks ----------
if (paginationNav) {
  paginationNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.page === 'prev') currentPage = Math.max(1, currentPage - 1);
    else if (btn.dataset.page === 'next') currentPage += 1;
    else currentPage = parseInt(btn.dataset.page, 10);
    renderTable();
  });
}

// ---------- filter dropdown ----------
const filterBtn = document.getElementById('umFilterBtn');
const filterPanel = document.getElementById('umFilterPanel');
if (filterBtn && filterPanel) {
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    filterPanel.classList.toggle('um-filter-panel--open');
  });
  filterPanel.addEventListener('change', (e) => {
    if (e.target.name === 'umStatusFilter') {
      currentStatus = e.target.value;
      currentPage = 1;
      renderTable();
    }
  });
  document.addEventListener('click', (e) => {
    if (!filterPanel.contains(e.target) && e.target !== filterBtn) {
      filterPanel.classList.remove('um-filter-panel--open');
    }
  });
}

// ---------- export CSV (exports the current page only — fine for now) ----------
const exportBtn = document.getElementById('umExportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    try {
      const { users } = await fetchUsers();
      const header = ['ID', 'Name', 'Role', 'Email', 'Joined', 'Status'];
      const lines = [header.join(',')].concat(
        users.map((u) => [u.id, `"${u.fullName}"`, u.roleLabel, u.email, formatDate(u.joined), u.status].join(','))
      );
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skin-goddess-users.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
  });
}

// ============ VIEW / EDIT MODAL ============
const modalOverlay = document.getElementById('umModalOverlay');
const modal = document.getElementById('umModal');
const modalEditBtn = document.getElementById('umModalEditBtn');
const modalSaveRow = document.getElementById('umModalSaveRow');
const modalQuickRow = document.getElementById('umModalQuickRow');
const modalSaveBtn = document.getElementById('umModalSaveBtn');
const modalCancelBtn = document.getElementById('umModalCancelBtn');
const modalSuspendBtn = document.getElementById('umModalSuspendBtn');
const modalDeleteBtn = document.getElementById('umModalDeleteBtn');

async function openModal(id) {
  editingUserId = id;
  modalOverlay.classList.add('um-modal-overlay--open');
  document.getElementById('umModalName').textContent = 'Loading…';

  try {
    const u = await apiRequest(`/api/users/${id}`);
    editingUserCache = u;
    populateModal(u);
    exitEditMode();
  } catch (error) {
    alert(error.message);
    closeModal();
  }
}

function closeModal() {
  modalOverlay.classList.remove('um-modal-overlay--open');
  exitEditMode();
  editingUserId = null;
  editingUserCache = null;
}

function populateModal(u) {
  document.getElementById('umModalName').textContent = u.fullName || '(no name)';
  document.getElementById('umModalId').textContent = `USR-${String(u.id).padStart(5, '0')}`;

  const badge = document.getElementById('umModalStatusBadge');
  badge.textContent = u.status === 'suspended' ? 'SUSPENDED' : `ACTIVE ${u.roleLabel}`;
  badge.className = 'um-status ' + (u.status === 'suspended' ? 'um-status--suspended' : 'um-status--active');

  // Not tracked without the appointments table wired in yet
  document.getElementById('umModalVisits').textContent = '—';
  document.getElementById('umModalVisitsLabel').textContent = 'not tracked yet';
  document.getElementById('umModalFirstVisit').textContent = 'N/A';
  document.getElementById('umModalLastVisit').textContent = 'N/A';
  document.getElementById('umModalFavServiceRow').style.display = 'none';
  document.getElementById('umModalAssignedRow').style.display = 'none';

  setField('umPiFullName', u.fullName);
  setField('umPiDob', formatDate(u.dob));
  setField('umPiSex', u.sex);
  setField('umPiCivilStatus', u.civilStatus);
  setField('umPiContact', u.contact);
  setField('umPiEmail', u.email);
  setField('umPiAddress', u.address);
  setField('umPiEmergency', 'Not tracked yet');

  // Skin/health fields don't exist as their own columns yet — hide that
  // section instead of showing fake data.
  document.getElementById('umSkinHealthSection').style.display = 'none';

  document.getElementById('umNoteCard').style.display = 'none';

  document.getElementById('umFooterMeta').textContent =
    `Account created: ${formatDate(u.joined)} · Last updated: ${formatDate(u.lastUpdated)}`;

  modalSuspendBtn.textContent = u.status === 'suspended' ? 'REACTIVATE' : 'SUSPEND';

  // Allergies / conditions shown read-only under Personal Information instead,
  // appended after Emergency Contact row for now.
  setField('umShConditions', u.conditions);
  renderAllergyTags(u.allergies);
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = (value === null || value === undefined || value === '') ? '—' : value;
}

function renderAllergyTags(allergies) {
  const box = document.getElementById('umShAllergies');
  if (!box) return;
  box.textContent = '';
  if (!allergies || !allergies.length) {
    box.textContent = 'None declared';
    return;
  }
  allergies.forEach((a) => {
    const span = document.createElement('span');
    span.className = 'um-allergy-tag';
    span.textContent = a;
    box.appendChild(span);
  });
}

// ---- edit mode (only fields the users table actually has) ----
const EDITABLE_TEXT_FIELDS = ['umPiFullName', 'umPiContact', 'umPiEmail', 'umPiAddress', 'umPiDob'];
const EDITABLE_SELECT_FIELDS = ['umPiSex', 'umPiCivilStatus'];

function enterEditMode() {
  EDITABLE_TEXT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    const value = el.textContent === '—' ? '' : el.textContent;
    const inputType = id === 'umPiDob' ? 'date' : id === 'umPiEmail' ? 'email' : 'text';
    el.innerHTML = `<input type="${inputType}" class="um-edit-input" value="${escapeHtml(value)}">`;
  });

  EDITABLE_SELECT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    const options = id === 'umPiSex' ? ['Female', 'Male', 'Other'] : ['Single', 'Married', 'Widowed', 'Separated'];
    const current = el.textContent;
    const opts = options.map((o) => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
    el.innerHTML = `<select class="um-edit-input">${opts}</select>`;
  });

  modal.classList.add('um-modal--editing');
  modalEditBtn.style.display = 'none';
  modalSaveRow.style.display = 'flex';
  modalQuickRow.style.display = 'none';
}

function exitEditMode() {
  modal.classList.remove('um-modal--editing');
  modalEditBtn.style.display = '';
  modalSaveRow.style.display = 'none';
  modalQuickRow.style.display = 'flex';
}

async function saveEdits() {
  const payload = {
    fullName: document.querySelector('#umPiFullName input').value.trim(),
    contact: document.querySelector('#umPiContact input').value.trim(),
    email: document.querySelector('#umPiEmail input').value.trim(),
    address: document.querySelector('#umPiAddress input').value.trim(),
    dob: document.querySelector('#umPiDob input').value || null,
    sex: document.querySelector('#umPiSex select').value,
    civilStatus: document.querySelector('#umPiCivilStatus select').value,
  };

  modalSaveBtn.disabled = true;
  modalSaveBtn.textContent = 'SAVING…';

  try {
    const updated = await apiRequest(`/api/users/${editingUserId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    editingUserCache = updated;
    exitEditMode();
    populateModal(updated);
    renderAll();
  } catch (error) {
    alert(error.message);
  } finally {
    modalSaveBtn.disabled = false;
    modalSaveBtn.textContent = 'SAVE';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (modalEditBtn) modalEditBtn.addEventListener('click', enterEditMode);
if (modalSaveBtn) modalSaveBtn.addEventListener('click', saveEdits);
if (modalCancelBtn) modalCancelBtn.addEventListener('click', () => {
  if (editingUserCache) populateModal(editingUserCache);
  exitEditMode();
});

if (modalSuspendBtn) {
  modalSuspendBtn.addEventListener('click', async () => {
    const nextStatus = editingUserCache.status === 'suspended' ? 'active' : 'suspended';
    try {
      const updated = await apiRequest(`/api/users/${editingUserId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      editingUserCache = updated;
      populateModal(updated);
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });
}

if (modalDeleteBtn) {
  modalDeleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${editingUserCache.fullName}? This cannot be undone.`)) return;
    try {
      await apiRequest(`/api/users/${editingUserId}`, { method: 'DELETE' });
      closeModal();
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });
}

document.getElementById('umModalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

// ---------- table row actions (event delegation) ----------
tableBody.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-action]');
  if (!link) return;
  e.preventDefault();
  const { action, id } = link.dataset;

  if (action === 'view' || action === 'edit') {
    openModal(id);
  } else if (action === 'restore') {
    try {
      await apiRequest(`/api/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  } else if (action === 'delete') {
    const row = link.closest('tr');
    const name = row.querySelector('.um-user-cell__name').textContent;
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await apiRequest(`/api/users/${id}`, { method: 'DELETE' });
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  }
});

// ============ CREATE NEW USER MODAL ============
const createOverlay = document.getElementById('umCreateOverlay');
const createBtn = document.getElementById('umCreateBtn');
const createClose = document.getElementById('umCreateClose');
const createForm = document.getElementById('umCreateForm');

function openCreateModal() { createOverlay.classList.add('um-modal-overlay--open'); }
function closeCreateModal() { createOverlay.classList.remove('um-modal-overlay--open'); createForm.reset(); }

if (createBtn) createBtn.addEventListener('click', openCreateModal);
if (createClose) createClose.addEventListener('click', closeCreateModal);
createOverlay.addEventListener('click', (e) => { if (e.target === createOverlay) closeCreateModal(); });

if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('umNewFullName').value.trim();
    const email = document.getElementById('umNewEmail').value.trim();
    const roleSelect = document.getElementById('umNewRole').value; // CLIENT|DOCTOR|ADMIN|CASHIER (display labels)
    const status = document.getElementById('umNewStatus').value;

    // Map the form's display-role options to real DB role enum values.
    const roleMap = { CLIENT: 'client', DOCTOR: 'aesthetician', ADMIN: 'admin', CASHIER: 'staff' };
    const role = roleMap[roleSelect] || 'client';

    const submitBtn = createForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      const { tempPassword } = await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, role, status }),
      });
      closeCreateModal();
      currentTab = 'ALL';
      tabsNav.querySelectorAll('.um-tab').forEach((t) => t.classList.remove('um-tab--active'));
      tabsNav.querySelector('[data-role="ALL"]').classList.add('um-tab--active');
      currentPage = 1;
      renderAll();
      alert(`User created. Temporary password (share with them once): ${tempPassword}`);
    } catch (error) {
      alert(error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create User';
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeCreateModal(); }
});

// ---------- mobile sidebar toggle ----------
const sidebarToggle = document.getElementById('umSidebarToggle');
const sidebar = document.getElementById('umSidebar');
const sidebarOverlay = document.getElementById('umSidebarOverlay');

function openSidebar() {
  sidebar.classList.add('um-sidebar--open');
  sidebarOverlay.classList.add('um-sidebar-overlay--open');
}
function closeSidebar() {
  sidebar.classList.remove('um-sidebar--open');
  sidebarOverlay.classList.remove('um-sidebar-overlay--open');
}
if (sidebarToggle) sidebarToggle.addEventListener('click', openSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

// ---------- init ----------
renderAll();