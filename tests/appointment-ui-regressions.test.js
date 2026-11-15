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

test('checkout return verifies payment and redirects even when booking storage is unavailable', async () => {
  const source = fs.readFileSync(path.join(root, 'appointment-summary.js'), 'utf8');
  async function runReturn({ status = 'consumed', confirmation = { appointment: { appointment_id: 42 } }, storageUnavailable = false } = {}) {
    const elements = new Map();
    const timers = [];
    const requests = [];
    function element() {
      return {
        hidden: false, textContent: '', children: [],
        setAttribute() {},
        addEventListener(type, handler) { this[type] = handler; },
        append(...children) { this.children.push(...children); },
        after(child) { elements.set(child.id, child); }
      };
    }
    const summary = element();
    const payment = element();
    elements.set('checkoutSummary', summary);
    elements.set('paymongoCheckout', payment);
    const document = { getElementById: (id) => elements.get(id) || null, createElement: element };
    const window = { location: { search: '?payment=success&reference=SG123', href: '' } };
    const localStorage = {
      getItem() { if (storageUnavailable) throw new Error('Storage unavailable'); return null; },
      removeItem() { if (storageUnavailable) throw new Error('Storage unavailable'); }
    };
    const fetch = async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.includes('/status/') ? { status } : confirmation };
    };
    vm.runInNewContext(source, {
      document, window, localStorage, fetch, URLSearchParams,
      setTimeout: (callback) => timers.push(callback),
      console: { warn() {} }
    });
    await new Promise((resolve) => setImmediate(resolve));
    return { window, summary, payment, elements, requests, timers };
  }

  const success = await runReturn({ storageUnavailable: true });
  assert.equal(success.summary.hidden, true);
  assert.deepEqual(success.requests, [
    '/api/appointments/paymongo/status/SG123', '/api/appointments/paymongo/confirm'
  ]);
  assert.equal(success.window.location.href, '');
  assert.equal(success.timers.length, 1);
  success.timers[0]();
  assert.equal(new URL(success.window.location.href, 'https://skingoddess.online').href,
    'https://skingoddess.online/UserAccount.html#appointments');

  const invalidConfirmation = await runReturn({ confirmation: {} });
  assert.equal(invalidConfirmation.window.location.href, '');
  assert.equal(invalidConfirmation.timers.length, 0);
  assert.match(invalidConfirmation.elements.get('checkoutMessage').textContent, /did not confirm/i);

  const failed = await runReturn({ status: 'failed' });
  assert.equal(failed.window.location.href, '');
  assert.equal(failed.payment.children[2].textContent, 'RETURN TO BOOKING');
  await failed.payment.children[2].click();
  assert.equal(failed.window.location.href, 'UserAppointment.html');
});

test('admin appointment status refresh is time-bounded and reports that saved rows remain available', () => {
  const adminSource = fs.readFileSync(path.join(root, 'AdminAppointment.js'), 'utf8');

  assert.match(adminSource, /statusRefreshController\.abort\(\)[\s\S]*?10000/);
  assert.match(adminSource, /signal: statusRefreshController\.signal/);
  assert.match(adminSource, /Showing the latest saved data; it will retry automatically\./);
  assert.doesNotMatch(adminSource, /The appointment list is still being loaded\./);
});

test('admin treatment history uses its admin appointments endpoint while staff keeps its own endpoint', () => {
  const historyScript = fs.readFileSync(path.join(root, 'staff-treatment-history.js'), 'utf8');
  const adminPage = fs.readFileSync(path.join(root, 'AdminTreatmentHistory.html'), 'utf8');

  assert.match(adminPage, /data-appointments-endpoint="\/api\/appointments\/admin"/);
  assert.match(historyScript, /document\.body\.dataset\.appointmentsEndpoint/);
  assert.match(historyScript, /fetch\(appointmentsEndpoint\)/);
  assert.match(historyScript, /\/api\/appointments\/treatment-history\/mine/);
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

test('aesthetician request dialogs ask for the appropriate details', () => {
  for (const filename of ['AestheticianAppointmentPage.html', 'StaffAppointmentPage.html']) {
    const pageSource = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(pageSource, /<button[^>]*type="button"[^>]*id="apptModalRescheduleBtn"/);
    assert.match(pageSource, /<dialog[^>]*id="apptRequestDialog"/);
    assert.match(pageSource, /id="apptCancellationReason"[^>]*required/);
    assert.match(pageSource, /<select name="date" id="apptRescheduleDate" required/);
    assert.match(pageSource, /<select name="time" id="apptRescheduleTime" required/);
    assert.doesNotMatch(pageSource, /Start Service/);
  }
});

test('aesthetician request dialogs submit to admin and can be reopened for another appointment', async () => {
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const elements = new Map();
  function createElement() {
    const listeners = {};
    const classes = new Set();
    return {
      listeners, dataset: {}, style: {}, value: '', hidden: false, disabled: false,
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      },
      addEventListener(type, handler) { listeners[type] = handler; },
      replaceChildren(...children) { this.children = children; },
      add(child) { this.children.push(child); },
      reset() {},
      focus() {},
      querySelector() { return this.submitButton; },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); }
    };
  }
  const ids = [
    'apptModalOverlay', 'apptModalTopbar', 'apptModalClose', 'apptModalCancelBtn',
    'apptModalRescheduleBtn', 'apptRescheduleForm', 'apptCancellationForm',
    'apptActionMessage', 'apptRequestStatus', 'apptRequestDialog', 'apptRequestTitle',
    'apptRequestClose', 'apptRescheduleMonth', 'apptRescheduleDate', 'apptRescheduleTime',
    'apptModalStatus', 'apptModalAvatar', 'apptModalName', 'apptModalSubtitle',
    'apptModalDate', 'apptModalTime', 'apptModalAesthetician', 'apptModalDuration',
    'apptModalService', 'apptModalFee', 'apptModalDeposit', 'apptModalContact'
  ];
  ids.forEach((id) => elements.set(id, createElement()));
  const reschedule = elements.get('apptRescheduleForm');
  const cancellation = elements.get('apptCancellationForm');
  reschedule.submitButton = createElement();
  cancellation.submitButton = createElement();
  reschedule.elements = {
    date: elements.get('apptRescheduleDate'), time: elements.get('apptRescheduleTime')
  };
  cancellation.elements = { reason: createElement() };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const data = url.startsWith('/api/availability')
      ? { '2026-10-18': ['10:00 AM'] }
      : { message: 'Request sent to the admin.' };
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  const document = {
    body: { style: {}, dataset: {} },
    getElementById: (id) => elements.get(id) || null,
    createElement, addEventListener() {}
  };
  const window = { dispatchEvent() {} };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-15T00:00:00Z'])); }
  }
  vm.runInNewContext(modalSource, {
    document, window, fetch, URLSearchParams, Date: TestDate, CustomEvent: class {}
  });
  const appointment = {
    id: 42, status: 'confirmed', date: '2026-11-18', start: '10:00',
    end: '11:00', client: 'Test Client', service: 'Facial', service_id: 7
  };
  window.openApptModal(appointment);
  elements.get('apptModalCancelBtn').listeners.click();
  assert.equal(elements.get('apptRequestDialog').open, true);
  assert.equal(cancellation.hidden, false);
  assert.equal(reschedule.hidden, true);
  cancellation.elements.reason.value = 'Schedule conflict';
  await cancellation.listeners.submit({ preventDefault() {} });
  assert.equal(calls[0].url, '/api/appointments/42/cancellation-request');
  assert.equal(JSON.parse(calls[0].options.body).reason, 'Schedule conflict');
  assert.equal(elements.get('apptRequestDialog').open, false);

  window.openApptModal({ ...appointment, id: 43 });
  assert.equal(cancellation.submitButton.disabled, false);
  elements.get('apptModalRescheduleBtn').listeners.click();
  assert.equal(elements.get('apptRequestDialog').open, true);
  assert.equal(reschedule.hidden, false);
  assert.equal(cancellation.hidden, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(calls[1].url, /serviceId=7&appointmentId=43/);
  assert.equal(reschedule.elements.date.disabled, false);
  reschedule.elements.date.value = '2026-11-18';
  elements.get('apptRescheduleDate').listeners.change();
  assert.equal(reschedule.elements.time.disabled, false);
  reschedule.elements.time.value = '10:00';
  await reschedule.listeners.submit({ preventDefault() {} });
  assert.equal(calls[2].url, '/api/appointments/43/reschedule');
  assert.equal(JSON.parse(calls[2].options.body).date, '2026-11-18');
  assert.equal(JSON.parse(calls[2].options.body).time, '10:00');
  assert.equal(elements.get('apptRequestDialog').open, false);
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
