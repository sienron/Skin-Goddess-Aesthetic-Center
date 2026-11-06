const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

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

test('appointment modal enables no-show for started in-progress appointments only', () => {
  const modalSource = fs.readFileSync(path.join(root, 'appointment-modal.js'), 'utf8');
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        dataset: {},
        classList: { add() {}, remove() {}, contains: () => false },
        style: {},
        addEventListener() {},
        textContent: '',
        disabled: false
      });
    }
    return nodes.get(id);
  }
  const document = {
    body: { style: {} },
    getElementById(id) {
      return ['apptRescheduleForm', 'apptCancellationForm', 'apptActionMessage'].includes(id)
        ? null
        : node(id);
    },
    addEventListener() {}
  };
  const context = {
    document,
    window: { confirm: () => true, dispatchEvent() {} },
    fetch: async () => ({ ok: true, text: async () => '{}' }),
    CustomEvent: class {}
  };
  vm.runInNewContext(modalSource, context);

  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  context.window.openApptModal({
    id: 42,
    status: 'in_progress',
    date,
    start: '09:00',
    end: '10:30',
    duration_minutes: 60,
    client: 'Jamie Client',
    service: 'Facial'
  });
  assert.equal(node('apptModalNoShowBtn').disabled, false);
  assert.equal(node('apptModalCancelBtn').disabled, true);

  context.window.openApptModal({
    id: 43,
    status: 'completed',
    date,
    start: '09:00',
    end: '10:30',
    duration_minutes: 60,
    client: 'Jamie Client',
    service: 'Facial'
  });
  assert.equal(node('apptModalNoShowBtn').disabled, true);
});

test('staff dashboard month keys follow Manila boundaries instead of UTC month boundaries', () => {
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
  assert.match(dashboardSource, /timeZone: "Asia\/Manila",\s+month: "long",\s+year: "numeric"/);
  assert.doesNotMatch(dashboardSource, /new Date\(\)\.toISOString\(\)\.slice\(0, 7\)/);
});
