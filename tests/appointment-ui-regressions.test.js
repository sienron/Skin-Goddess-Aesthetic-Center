const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('confirmed booking redirects to the appointments section of the account page', () => {
  const checkoutSource = fs.readFileSync(path.join(root, 'appointment-summary.js'), 'utf8');
  const accountPage = fs.readFileSync(path.join(root, 'UserAccount.html'), 'utf8');

  assert.match(checkoutSource, /window\.location\.href = ['"]\/UserAccount\.html#appointments['"]/);
  assert.match(accountPage, /data-profile-section="appointments"/);
  assert.match(accountPage, /data-profile-panel="appointments"/);
});

test('appointment modal keeps shared helpers private while retaining its public API', () => {
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const staffSource = fs.readFileSync(path.join(root, 'appointments-staff.js'), 'utf8');
  const window = {};
  const context = {
    document: { getElementById: () => null },
    window
  };

  vm.runInNewContext(`${modalSource}\nconst STATUS_LABELS = {};\nfunction formatTime() {}`, context);

  assert.equal(typeof window.openApptModal, 'function');
  assert.equal(typeof window.closeApptModal, 'function');
  assert.match(modalSource, /const APPT_MODAL_STATUS_LABELS/);
  assert.match(modalSource, /function formatApptModalTime\(/);
  assert.doesNotMatch(modalSource, /const STATUS_LABELS|function formatTime\(/);
  assert.doesNotThrow(() => window.openApptModal({}));
  assert.doesNotThrow(() => window.closeApptModal());
  assert.match(staffSource, /function formatStaffAppointmentTime\(/);
  assert.doesNotMatch(staffSource, /function formatTime\(/);
});

test('appointment modal compares service dates using the Manila calendar day', () => {
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const helperStart = modalSource.indexOf('function getApptManilaDateKey(');
  const helperEnd = modalSource.indexOf('\nconst apptModalOverlay', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Manila date helper should be present');
  const getApptManilaDateKey = vm.runInNewContext(
    `(() => { ${modalSource.slice(helperStart, helperEnd)}; return getApptManilaDateKey; })()`
  );

  assert.equal(getApptManilaDateKey(new Date('2026-11-14T15:59:00.000Z')), '2026-11-14');
  assert.equal(getApptManilaDateKey(new Date('2026-11-14T16:00:00.000Z')), '2026-11-15');
});

test('opening an appointment modal populates details and displays the overlay', () => {
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const ids = [
    'apptModalOverlay', 'apptModal', 'apptModalTopbar', 'apptModalClose',
    'apptModalCancelBtn', 'apptModalRescheduleBtn', 'apptModalFinishBtn',
    'apptModalClientInfoBtn', 'apptRescheduleForm', 'apptCancellationForm',
    'apptActionMessage', 'apptRescheduleMonth', 'apptRescheduleDate',
    'apptRescheduleTime', 'apptModalStatus', 'apptModalAvatar', 'apptModalName',
    'apptModalSubtitle', 'apptModalDate', 'apptModalTime', 'apptModalAesthetician',
    'apptModalDuration', 'apptModalService', 'apptModalFee', 'apptModalDeposit',
    'apptModalContact'
  ];
  const elements = new Map();
  function createElement() {
    const classes = new Set();
    return {
      className: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name)
      },
      dataset: {},
      style: {},
      addEventListener() {},
      replaceChildren(...children) { this.children = children; },
      add(child) { (this.children ||= []).push(child); },
      reset() {},
      querySelector() { return createElement(); }
    };
  }
  ids.forEach((id) => elements.set(id, createElement()));
  const rescheduleForm = elements.get('apptRescheduleForm');
  rescheduleForm.elements = {
    date: elements.get('apptRescheduleDate'),
    time: elements.get('apptRescheduleTime'),
    reason: createElement(),
    description: createElement()
  };
  rescheduleForm.querySelector = () => createElement();
  const document = {
    body: { style: {} },
    getElementById: (id) => elements.get(id) || null,
    createElement,
    addEventListener() {}
  };
  const window = {};

  vm.runInNewContext(modalSource, { document, window });
  window.openApptModal({
    id: 42,
    status: 'confirmed',
    date: '2026-11-14',
    start: '10:00',
    end: '11:00',
    client: 'Test Client',
    service: 'Test Service'
  });

  assert.equal(elements.get('apptModalOverlay').classList.contains('show'), true);
  assert.equal(elements.get('apptModalName').textContent, 'Test Client');
  assert.equal(elements.get('apptRescheduleDate').min.length > 0, true);
});

test('staff appointment header omits the placeholder monthly overview subtitle', () => {
  const staffPage = fs.readFileSync(path.join(root, 'StaffAppointmentPage.html'), 'utf8');
  const pageTitle = staffPage.match(/<div class="page-title">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(pageTitle, 'staff appointment page title should be present');
  assert.doesNotMatch(pageTitle, /Monthly overview|Month 0000/);
});

test('cancellation form honors its hidden state and treatment-note removal uses a modal', () => {
  const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const notesSource = fs.readFileSync(path.join(root, 'treatment-notes.js'), 'utf8');
  assert.match(styles, /\.appt-cancellation-form\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(notesSource, /Remove this treatment note\?/);
  assert.match(notesSource, /role="dialog" aria-modal="true"/);
  assert.doesNotMatch(notesSource, /window\.confirm\(/);
});

test('staff appointment modals do not expose the no-show action', () => {
  const staffPage = fs.readFileSync(path.join(root, 'StaffAppointmentPage.html'), 'utf8');
  const aestheticianPage = fs.readFileSync(path.join(root, 'AestheticianAppointmentPage.html'), 'utf8');
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  assert.doesNotMatch(staffPage, /apptModalNoShowBtn/);
  assert.doesNotMatch(aestheticianPage, /apptModalNoShowBtn/);
  assert.doesNotMatch(modalSource, /apptModalNoShowBtn|\/no-show/);
});

test('aesthetician reschedule modal requires the details accepted by its request endpoint', () => {
  for (const filename of ['AestheticianAppointmentPage.html', 'StaffAppointmentPage.html']) {
    const pageSource = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(pageSource, /<button[^>]*type="button"[^>]*id="apptModalRescheduleBtn"/);
    assert.match(pageSource, /id="apptRescheduleReason"[^>]*required/);
    assert.match(pageSource, /id="apptRescheduleDescription"[^>]*required/);
    assert.doesNotMatch(pageSource, /Start Service/);
  }
});

test('client account reschedule form uses availability controls and immediate cancellation endpoint', () => {
  const accountPage = fs.readFileSync(path.join(root, 'UserAccount.html'), 'utf8');
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const stylesheet = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const customerAppointmentHistory = fs.readFileSync(path.join(root, 'utils', 'customerAppointmentHistory.js'), 'utf8');

  assert.match(accountPage, /id="apptRescheduleMonth"/);
  assert.match(accountPage, /<select name="date" id="apptRescheduleDate"/);
  assert.match(accountPage, /<textarea name="reason" id="apptRescheduleReason"[^>]*required/);
  assert.match(accountPage, /<button type="button" class="modal-btn modal-btn-cancel" id="apptModalCancelBtn"/);
  assert.match(accountPage, /<button type="button" class="modal-btn modal-btn-reschedule" id="apptModalRescheduleBtn"/);
  assert.doesNotMatch(accountPage, /id="apptRescheduleDescription"/);
  assert.match(modalSource, /dataset\?\.page === "account"/);
  assert.match(modalSource, /cancel-mine/);
  assert.match(customerAppointmentHistory, /a\.service_id/);
  assert.match(stylesheet, /\.client-header \.appt-reschedule-form \{[\s\S]*?padding: 20px 30px 8px/);
  assert.match(stylesheet, /\.client-header \.appt-modal-actions \.modal-btn \{\s*padding: 11px 16px;/);
});

test('staff dashboard month keys follow Manila boundaries and obsolete overview copy is absent', () => {
  const dashboardSource = fs.readFileSync(path.join(root, 'staff-dashboard.js'), 'utf8');
  const helperStart = dashboardSource.indexOf('    function localDateString(');
  const helperEnd = dashboardSource.indexOf('    function formatDate(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Manila date helpers should be present in the dashboard');
  const monthKey = vm.runInNewContext(
    `(() => { ${dashboardSource.slice(helperStart, helperEnd)}; return manilaMonthKey; })()`
  );

  assert.equal(monthKey(new Date('2026-03-31T16:30:00.000Z')), '2026-04');
  assert.equal(monthKey(new Date('2026-04-30T15:59:00.000Z')), '2026-04');
  assert.match(dashboardSource, /const thisMonth = manilaMonthKey\(now\)/);
  const dashboardHtml = fs.readFileSync(path.join(root, 'StaffDashboard.html'), 'utf8');
  assert.doesNotMatch(dashboardHtml, /Monthly overview|Month 0000/);
  assert.doesNotMatch(dashboardSource, /new Date\(\)\.toISOString\(\)\.slice\(0, 7\)/);
});
