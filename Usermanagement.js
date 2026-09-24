// ============ USER MANAGEMENT PAGE ============
// Client-side demo data + wiring. Swap USERS_DATA / the CRUD functions below
// for real fetch() calls to your backend once the API routes are ready.

let USERS_DATA = [
  {
    id: 'USR-00198', fullName: 'Admin', initials: 'A', role: 'ADMIN', roleLabel: 'STAFF',
    sex: 'Female', age: 28, email: 'admin@skingoddess.ph', joined: 'Mar 20, 2025',
    visits: null, visitsLabel: 'staff account', lastVisit: 'Apr 14, 2025', status: 'active',
    dob: 'Mar 20, 1997 (28 yrs)', civilStatus: 'Single', contact: '+63 917 000 0001',
    address: 'Imus, Cavite, Philippines', emergency: 'N/A', skinType: 'N/A', concern: 'N/A',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'N/A', favService: 'N/A', assignedTo: 'N/A',
    note: { meta: 'ACCOUNT · SYSTEM ADMIN', text: 'Manages system users, roles, and content.' },
    accountCreated: 'Mar 20, 2025', lastUpdated: 'Apr 14, 2025'
  },
  {
    id: 'USR-00195', fullName: 'James Torres', initials: 'JT', role: 'CLIENT', roleLabel: 'CLIENT',
    sex: 'Male', age: 31, email: 'james.torres@email.com', joined: 'Dec 2, 2024',
    visits: 4, visitsLabel: 'visits total', lastVisit: 'Apr 14, 2025', status: 'active',
    dob: 'May 2, 1993 (31 yrs)', civilStatus: 'Married', contact: '+63 917 123 1195',
    address: 'Dasmariñas, Cavite, Philippines', emergency: 'Anna Torres · +63 917 555 0195',
    skinType: 'Oily · Acne-prone', concern: 'Breakouts · Enlarged Pores',
    allergies: ['Benzoyl Peroxide'], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'Dec 2, 2024', favService: 'Acne Facial', assignedTo: 'Dr. Sofia Reyes',
    note: { meta: 'SESSION NOTE · APR 14, 2025 · Dr. Sofia Reyes', text: 'Breakouts have reduced since starting the acne facial series. Continue current routine, follow-up in 3 weeks.' },
    accountCreated: 'Dec 2, 2024', lastUpdated: 'Apr 14, 2025'
  },
  {
    id: 'STF-00002', fullName: 'Dr. Sofia Reyes', initials: 'SR', role: 'DOCTOR', roleLabel: 'DOCTOR',
    sex: 'Female', age: 34, email: 'sofia.reyes@skingoddess.ph', joined: 'Jan 5, 2023',
    visits: null, visitsLabel: 'staff account', lastVisit: 'Today, 8:02 AM', status: 'active',
    dob: 'Aug 19, 1990 (34 yrs)', civilStatus: 'Married', contact: '+63 917 234 5678',
    address: 'Imus, Cavite, Philippines', emergency: 'N/A', skinType: 'N/A', concern: 'N/A',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'N/A', favService: 'N/A', assignedTo: 'N/A',
    note: { meta: 'ACCOUNT · LEAD AESTHETICIAN', text: 'Oversees facial treatments and staff scheduling for the aesthetics team.' },
    accountCreated: 'Jan 5, 2023', lastUpdated: 'Apr 14, 2025'
  },
  {
    id: 'USR-00190', fullName: 'Claire Mendoza', initials: 'CM', role: 'CLIENT', roleLabel: 'CLIENT',
    sex: 'Female', age: 34, email: 'claire.m@email.com', joined: 'Feb 1, 2025',
    visits: 10, visitsLabel: 'visits total', lastVisit: 'Apr 12, 2025', status: 'active',
    dob: 'Jun 15, 1990 (34 yrs)', civilStatus: 'Single', contact: '+63 917 123 4567',
    address: 'Quezon City, Metro Manila, Philippines', emergency: 'Maria Mendoza · +63 917 765 4321',
    skinType: 'Combination · Sensitive', concern: 'Dryness · Uneven Tone',
    allergies: ['Fragrance', 'Lanolin', 'Salicylic Acid'], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'Feb 1, 2025', favService: 'Hydrating Facial', assignedTo: 'Dr. Sofia Reyes',
    note: { meta: 'SESSION NOTE · APR 12, 2025 · Dr. Sofia Reyes', text: 'Skin responded well to the hydrating facial. Noticeable improvement in moisture levels. Recommended SPF 50 daily and follow-up in 4 wks.' },
    accountCreated: 'Feb 1, 2025', lastUpdated: 'Apr 12, 2025'
  },
  {
    id: 'STF-00004', fullName: 'RN Maria Lim', initials: 'ML', role: 'DOCTOR', roleLabel: 'DOCTOR',
    sex: 'Female', age: 29, email: 'maria.lim@skingoddess.ph', joined: 'Mar 10, 2023',
    visits: null, visitsLabel: 'staff account', lastVisit: 'Today, 9:15 AM', status: 'active',
    dob: 'Feb 14, 1996 (29 yrs)', civilStatus: 'Single', contact: '+63 917 345 6789',
    address: 'Imus, Cavite, Philippines', emergency: 'N/A', skinType: 'N/A', concern: 'N/A',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'N/A', favService: 'N/A', assignedTo: 'N/A',
    note: { meta: 'ACCOUNT · SKIN CARE SPECIALIST', text: 'Handles skin consultations and treatment prep.' },
    accountCreated: 'Mar 10, 2023', lastUpdated: 'Apr 14, 2025'
  },
  {
    id: 'USR-00188', fullName: 'Lea Pascual', initials: 'LP', role: 'CLIENT', roleLabel: 'CLIENT',
    sex: 'Female', age: 42, email: 'lea.pascual@email.com', joined: 'Nov 14, 2024',
    visits: 15, visitsLabel: 'visits total', lastVisit: 'Apr 14, 2025', status: 'active',
    dob: 'Jul 3, 1982 (42 yrs)', civilStatus: 'Married', contact: '+63 917 456 7890',
    address: 'Bacoor, Cavite, Philippines', emergency: 'Ramon Pascual · +63 917 890 1234',
    skinType: 'Normal', concern: 'Fine Lines · Dullness',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'Nov 14, 2024', favService: 'Anti-Aging Facial', assignedTo: 'RN Maria Lim',
    note: { meta: 'SESSION NOTE · APR 14, 2025 · RN Maria Lim', text: 'Regular client, consistent monthly visits. Skin texture has improved steadily. Continue current regimen.' },
    accountCreated: 'Nov 14, 2024', lastUpdated: 'Apr 14, 2025'
  },
  {
    id: 'USR-00171', fullName: 'Marco Villanueva', initials: 'MV', role: 'CLIENT', roleLabel: 'CLIENT',
    sex: 'Male', age: 38, email: 'marco.v@email.com', joined: 'Sep 8, 2024',
    visits: 3, visitsLabel: 'visits total', lastVisit: 'Mar 2, 2025', status: 'suspended',
    dob: 'Oct 21, 1986 (38 yrs)', civilStatus: 'Single', contact: '+63 917 567 8901',
    address: 'Imus, Cavite, Philippines', emergency: 'N/A',
    skinType: 'Oily', concern: 'Breakouts',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'Sep 8, 2024', favService: 'Deep Cleansing Facial', assignedTo: 'Dr. Sofia Reyes',
    note: { meta: 'SESSION NOTE · MAR 2, 2025 · Dr. Sofia Reyes', text: 'Account suspended — repeated no-shows without cancellation notice.' },
    accountCreated: 'Sep 8, 2024', lastUpdated: 'Mar 2, 2025'
  },
  {
    id: 'USR-00214', fullName: 'Rachel Gomez', initials: 'RG', role: 'CLIENT', roleLabel: 'CLIENT',
    sex: 'Female', age: 26, email: 'rachel.g@email.com', joined: 'Apr 14, 2025',
    visits: 1, visitsLabel: 'first visit', lastVisit: 'Apr 14, 2025', status: 'active',
    dob: 'May 30, 1998 (26 yrs)', civilStatus: 'Single', contact: '+63 917 678 9012',
    address: 'Dasmariñas, Cavite, Philippines', emergency: 'N/A',
    skinType: 'Dry', concern: 'Dullness',
    allergies: [], conditions: 'None declared', medications: 'None declared',
    firstVisit: 'Apr 14, 2025', favService: 'Hydrating Facial', assignedTo: 'Dr. Sofia Reyes',
    note: { meta: 'SESSION NOTE · APR 14, 2025 · Dr. Sofia Reyes', text: 'First-time client. Recommended a 3-session hydrating facial package.' },
    accountCreated: 'Apr 14, 2025', lastUpdated: 'Apr 14, 2025'
  }
];

const PAGE_SIZE = 5;
let currentPage = 1;
let currentTab = 'ALL';
let currentStatus = 'ALL';
let currentSearch = '';
let editingUserId = null;

// ---------- elements ----------
const tableBody = document.getElementById('umTableBody');
const tabsNav = document.getElementById('umTabs');
const searchInput = document.getElementById('umSearchInput');
const selectAll = document.getElementById('umSelectAll');
const showingText = document.getElementById('umShowingText');
const paginationNav = document.getElementById('umPagination');

// ---------- helpers ----------
function badgeClass(role) {
  return { ADMIN: 'staff', CLIENT: 'client', DOCTOR: 'doctor', CASHIER: 'client' }[role] || 'client';
}

function getFilteredUsers() {
  return USERS_DATA.filter((u) => {
    const tabOk = currentTab === 'ALL'
      ? true
      : currentTab === 'SUSPENDED'
        ? u.status === 'suspended'
        : u.role === currentTab;
    const statusOk = currentStatus === 'ALL' ? true : u.status === currentStatus;
    const q = currentSearch.trim().toLowerCase();
    const searchOk = !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    return tabOk && statusOk && searchOk;
  });
}

function rowHTML(u) {
  const visitsCell = u.visits === null
    ? `<span class="um-visits__count">—</span><span class="um-visits__label">${u.visitsLabel}</span>`
    : `<span class="um-visits__count">${u.visits}</span><span class="um-visits__label">${u.visitsLabel}</span>`;

  const statusCell = u.status === 'suspended'
    ? `<span class="um-status um-status--suspended">&bull; SUSPENDED</span>`
    : `<span class="um-status um-status--active">&bull; ACTIVE</span>`;

  const suspendAction = u.status === 'suspended'
    ? `<a href="#" class="um-action" data-action="restore" data-id="${u.id}">Restore</a>`
    : `<a href="#" class="um-action" data-action="edit" data-id="${u.id}">Edit</a>`;

  return `
    <tr data-id="${u.id}" class="${u.status === 'suspended' ? 'um-row--muted' : ''}">
      <td><input type="checkbox" class="um-row-check"></td>
      <td class="um-user-cell">
        <span class="um-avatar um-avatar--sm ${u.status === 'suspended' ? 'um-avatar--muted' : ''}">${u.initials}</span>
        <span class="um-user-cell__info">
          <span class="um-user-cell__name">${u.fullName}</span>
          <span class="um-user-cell__meta">${u.id} &middot; ${u.sex.charAt(0)}, ${u.age}</span>
        </span>
      </td>
      <td><span class="um-badge um-badge--${badgeClass(u.role)}">${u.roleLabel}</span></td>
      <td>${u.email}</td>
      <td>${u.joined}</td>
      <td class="um-visits">${visitsCell}</td>
      <td>${u.lastVisit}</td>
      <td>${statusCell}</td>
      <td class="um-actions">
        <a href="#" class="um-action um-action--view" data-action="view" data-id="${u.id}">View</a>
        ${suspendAction}
        <a href="#" class="um-action um-action--danger" data-action="delete" data-id="${u.id}">Del</a>
      </td>
    </tr>`;
}

function renderTable() {
  const filtered = getFilteredUsers();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  tableBody.innerHTML = pageItems.length
    ? pageItems.map(rowHTML).join('')
    : `<tr><td colspan="9" style="text-align:center; padding:24px; color:#8a837a;">No users match your search/filter.</td></tr>`;

  showingText.textContent = `Showing ${pageItems.length} of ${filtered.length} users`;
  if (selectAll) selectAll.checked = false;

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  let html = `<button type="button" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<button type="button" data-page="${p}" class="${p === currentPage ? 'active' : ''}">${p}</button>`;
  }
  html += `<button type="button" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  paginationNav.innerHTML = html;
}

function renderStats() {
  const total = USERS_DATA.length;
  const clients = USERS_DATA.filter((u) => u.role === 'CLIENT').length;
  const staff = USERS_DATA.filter((u) => ['DOCTOR', 'ADMIN', 'CASHIER'].includes(u.role)).length;
  const suspended = USERS_DATA.filter((u) => u.status === 'suspended').length;

  document.getElementById('statTotalUsers').textContent = total;
  document.getElementById('statClients').textContent = clients;
  document.getElementById('statStaff').textContent = staff;
  document.getElementById('statSuspended').textContent = suspended;
  document.getElementById('statTotalUsersHint').textContent = `${total} total accounts`;
  document.getElementById('statSuspendedHint').textContent = `${suspended} suspended account${suspended === 1 ? '' : 's'}`;
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
    currentTab = btn.dataset.role;
    currentPage = 1;
    renderTable();
  });
}

// ---------- search ----------
if (searchInput) {
  searchInput.addEventListener('input', () => {
    currentSearch = searchInput.value;
    currentPage = 1;
    renderTable();
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
    const filtered = getFilteredUsers();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (btn.dataset.page === 'prev') currentPage = Math.max(1, currentPage - 1);
    else if (btn.dataset.page === 'next') currentPage = Math.min(totalPages, currentPage + 1);
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

// ---------- export CSV ----------
const exportBtn = document.getElementById('umExportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const rows = getFilteredUsers();
    const header = ['ID', 'Name', 'Role', 'Email', 'Joined', 'Status'];
    const lines = [header.join(',')].concat(
      rows.map((u) => [u.id, `"${u.fullName}"`, u.roleLabel, u.email, u.joined, u.status].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skin-goddess-users.csv';
    a.click();
    URL.revokeObjectURL(url);
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

function findUser(id) {
  return USERS_DATA.find((u) => u.id === id);
}

function openModal(id) {
  const u = findUser(id);
  if (!u) return;
  editingUserId = id;
  populateModal(u);
  exitEditMode();
  modalOverlay.classList.add('um-modal-overlay--open');
}

function closeModal() {
  modalOverlay.classList.remove('um-modal-overlay--open');
  exitEditMode();
  editingUserId = null;
}

function populateModal(u) {
  document.getElementById('umModalName').textContent = u.fullName;
  document.getElementById('umModalId').textContent = u.id;

  const badge = document.getElementById('umModalStatusBadge');
  badge.textContent = u.status === 'suspended' ? 'SUSPENDED' : `ACTIVE ${u.roleLabel}`;
  badge.className = 'um-status ' + (u.status === 'suspended' ? 'um-status--suspended' : 'um-status--active');

  document.getElementById('umModalVisits').textContent = u.visits === null ? '—' : u.visits;
  document.getElementById('umModalVisitsLabel').textContent = u.visitsLabel;
  document.getElementById('umModalFirstVisit').textContent = u.firstVisit;
  document.getElementById('umModalLastVisit').textContent = u.lastVisit;
  document.getElementById('umModalFavService').textContent = u.favService;
  document.getElementById('umModalAssigned').textContent = u.assignedTo;

  setField('umPiFullName', u.fullName);
  setField('umPiDob', u.dob);
  setField('umPiSex', u.sex);
  setField('umPiCivilStatus', u.civilStatus);
  setField('umPiContact', u.contact);
  setField('umPiEmail', u.email);
  setField('umPiAddress', u.address);
  setField('umPiEmergency', u.emergency);
  setField('umShSkinType', u.skinType);
  setField('umShConcern', u.concern);
  setField('umShConditions', u.conditions);
  setField('umShMeds', u.medications);

  renderAllergyTags(u.allergies);

  document.getElementById('umNoteMeta').textContent = u.note.meta;
  document.getElementById('umNoteText').textContent = u.note.text;
  document.getElementById('umFooterMeta').textContent = `Account created: ${u.accountCreated} · Last updated: ${u.lastUpdated}`;

  modalSuspendBtn.textContent = u.status === 'suspended' ? 'REACTIVATE' : 'SUSPEND';
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

function renderAllergyTags(allergies) {
  const box = document.getElementById('umShAllergies');
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

// ---- edit mode ----
const EDITABLE_TEXT_FIELDS = ['umPiFullName', 'umPiDob', 'umPiContact', 'umPiEmail', 'umPiAddress', 'umPiEmergency', 'umShSkinType', 'umShConcern', 'umShConditions', 'umShMeds'];
const EDITABLE_SELECT_FIELDS = ['umPiSex', 'umPiCivilStatus'];

function enterEditMode() {
  const u = findUser(editingUserId);
  if (!u) return;

  EDITABLE_TEXT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    const value = el.textContent === '—' ? '' : el.textContent;
    el.innerHTML = `<input type="text" class="um-edit-input" value="${escapeHtml(value)}">`;
  });

  EDITABLE_SELECT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    const options = el.dataset.options.split(',');
    const current = el.textContent;
    const opts = options.map((o) => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
    el.innerHTML = `<select class="um-edit-input">${opts}</select>`;
  });

  const allergyBox = document.getElementById('umShAllergies');
  const current = (u.allergies || []).join(', ');
  allergyBox.innerHTML = `<input type="text" class="um-edit-input" id="umShAllergiesInput" placeholder="e.g. Fragrance, Lanolin" value="${escapeHtml(current)}">`;

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

function saveEdits() {
  const u = findUser(editingUserId);
  if (!u) return;

  u.fullName = document.querySelector('#umPiFullName input').value.trim() || u.fullName;
  u.dob = document.querySelector('#umPiDob input').value.trim() || u.dob;
  u.sex = document.querySelector('#umPiSex select').value;
  u.civilStatus = document.querySelector('#umPiCivilStatus select').value;
  u.contact = document.querySelector('#umPiContact input').value.trim();
  u.email = document.querySelector('#umPiEmail input').value.trim() || u.email;
  u.address = document.querySelector('#umPiAddress input').value.trim();
  u.emergency = document.querySelector('#umPiEmergency input').value.trim();
  u.skinType = document.querySelector('#umShSkinType input').value.trim();
  u.concern = document.querySelector('#umShConcern input').value.trim();
  u.conditions = document.querySelector('#umShConditions input').value.trim();
  u.medications = document.querySelector('#umShMeds input').value.trim();

  const allergiesRaw = document.getElementById('umShAllergiesInput').value.trim();
  u.allergies = allergiesRaw ? allergiesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  u.initials = u.fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  u.lastUpdated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  exitEditMode();
  populateModal(u);
  renderAll();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (modalEditBtn) modalEditBtn.addEventListener('click', enterEditMode);
if (modalSaveBtn) modalSaveBtn.addEventListener('click', saveEdits);
if (modalCancelBtn) modalCancelBtn.addEventListener('click', () => populateModal(findUser(editingUserId)) && exitEditMode());

if (modalSuspendBtn) {
  modalSuspendBtn.addEventListener('click', () => {
    const u = findUser(editingUserId);
    if (!u) return;
    u.status = u.status === 'suspended' ? 'active' : 'suspended';
    populateModal(u);
    renderAll();
  });
}

if (modalDeleteBtn) {
  modalDeleteBtn.addEventListener('click', () => {
    const u = findUser(editingUserId);
    if (!u) return;
    if (!confirm(`Delete ${u.fullName}? This cannot be undone.`)) return;
    USERS_DATA = USERS_DATA.filter((x) => x.id !== u.id);
    closeModal();
    renderAll();
  });
}

document.getElementById('umModalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeCreateModal(); } });

// ---------- table row actions (event delegation) ----------
tableBody.addEventListener('click', (e) => {
  const link = e.target.closest('[data-action]');
  if (!link) return;
  e.preventDefault();
  const { action, id } = link.dataset;
  const u = findUser(id);
  if (!u) return;

  if (action === 'view' || action === 'edit') {
    openModal(id);
  } else if (action === 'restore') {
    u.status = 'active';
    renderAll();
  } else if (action === 'delete') {
    if (!confirm(`Delete ${u.fullName}? This cannot be undone.`)) return;
    USERS_DATA = USERS_DATA.filter((x) => x.id !== id);
    renderAll();
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
  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fullName = document.getElementById('umNewFullName').value.trim();
    const email = document.getElementById('umNewEmail').value.trim();
    const role = document.getElementById('umNewRole').value;
    const status = document.getElementById('umNewStatus').value;
    if (!fullName || !email) return;

    const nextNum = USERS_DATA.length + 1;
    const newUser = {
      id: `USR-${String(214 + nextNum).padStart(5, '0')}`,
      fullName, initials: fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''),
      role, roleLabel: role === 'ADMIN' ? 'STAFF' : role,
      sex: '—', age: '—', email, joined: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      visits: role === 'CLIENT' ? 0 : null, visitsLabel: role === 'CLIENT' ? 'first visit' : 'staff account',
      lastVisit: '—', status,
      dob: '—', civilStatus: '—', contact: '—', address: '—', emergency: '—',
      skinType: '—', concern: '—', allergies: [], conditions: 'None declared', medications: 'None declared',
      firstVisit: '—', favService: '—', assignedTo: '—',
      note: { meta: 'NEW ACCOUNT', text: 'No treatment notes yet.' },
      accountCreated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), lastUpdated: '—'
    };

    USERS_DATA.unshift(newUser);
    closeCreateModal();
    currentTab = 'ALL';
    tabsNav.querySelectorAll('.um-tab').forEach((t) => t.classList.remove('um-tab--active'));
    tabsNav.querySelector('[data-role="ALL"]').classList.add('um-tab--active');
    currentPage = 1;
    renderAll();
  });
}

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