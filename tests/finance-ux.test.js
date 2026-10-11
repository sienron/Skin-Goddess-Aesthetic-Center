const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'finance-common.js'), 'utf8');

function makeElement() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    hidden: false,
    isConnected: true,
    value: '',
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    listeners,
    attributes,
    classList: {
      toggle(name, active) { this[name] = active; },
    },
    addEventListener(name, listener) { listeners.set(name, listener); },
    append(child) { this.children.push(child); },
    closest() { return this.frame || null; },
    focus() { this.ownerDocument.activeElement = this; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains(element) { return element === this; },
  };
}

function loadCommon() {
  const document = {
    activeElement: null,
    elements: new Map(),
    createElement() {
      const element = makeElement();
      element.ownerDocument = document;
      return element;
    },
    getElementById(id) { return this.elements.get(id) || null; },
  };
  const window = {};
  vm.runInNewContext(source, { window, document });
  return { common: window.FinanceCommon, document, window };
}

describe('Finance UX shared helpers', () => {
  it('builds consistent preset ranges and comparable prior periods', () => {
    const { common } = loadCommon();
    assert.deepEqual({ ...common.periodRange('today', '2025-03-05') }, {
      from: '2025-03-05',
      to: '2025-03-05',
    });
    assert.deepEqual({ ...common.periodRange('month', '2025-03-05') }, {
      from: '2025-03-01',
      to: '2025-03-05',
    });
    assert.deepEqual({ ...common.periodRange('last-month', '2025-03-05') }, {
      from: '2025-02-01',
      to: '2025-02-28',
    });
    assert.deepEqual({ ...common.previousRange('2025-03-01', '2025-03-20') }, {
      from: '2025-02-01',
      to: '2025-02-20',
    });
    assert.deepEqual({ ...common.previousRange('2025-03-05', '2025-03-10') }, {
      from: '2025-02-27',
      to: '2025-03-04',
    });
    assert.equal(common.isValidRange('2025-02-30', '2025-03-01'), false);
    assert.throws(() => common.previousRange('2025-03-10', '2025-03-01'), /valid date range/);
  });

  it('labels comparisons with a meaningful zero baseline', () => {
    const { common } = loadCommon();
    assert.match(common.formatComparison(0, 0), /No change/);
    assert.match(common.formatComparison(25, 0), /no previous-period activity/);
    assert.match(common.formatComparison(75, 50), /Increase of .*50\.0%/);
  });

  it('creates readable payment and expense status badges', () => {
    const { common } = loadCommon();
    const posted = common.statusBadge('posted');
    const voided = common.statusBadge('voided');
    assert.equal(posted.textContent, 'Posted');
    assert.equal(posted.attributes.get('aria-label'), 'Status: Posted');
    assert.match(posted.className, /fin-status-badge--posted/);
    assert.equal(voided.textContent, 'Voided');
  });

  it('applies presets and rejects reversed custom date ranges', () => {
    const { common, document } = loadCommon();
    const fromInput = makeElement();
    const toInput = makeElement();
    fromInput.ownerDocument = document;
    toInput.ownerDocument = document;
    const invalidMessages = [];
    const changes = [];
    const button = (period) => {
      const item = makeElement();
      item.dataset.period = period;
      item.classList = { toggle(name, active) { this[name] = active; } };
      return item;
    };
    const today = button('today');
    const custom = button('custom');
    common.bindPeriodControls({
      fromInput,
      toInput,
      buttons: [today, custom],
      onChange: (range) => changes.push({ ...range }),
      onInvalid: (message) => invalidMessages.push(message),
    });
    today.listeners.get('click')();
    assert.equal(fromInput.value, toInput.value);
    assert.equal(changes.length, 1);
    fromInput.value = '2025-03-10';
    toInput.value = '2025-03-01';
    fromInput.listeners.get('change')();
    assert.equal(changes.length, 1);
    assert.equal(invalidMessages.length, 1);
    assert.equal(fromInput.attributes.get('aria-invalid'), 'true');
    custom.listeners.get('click')();
    assert.equal(document.activeElement, fromInput);
  });

  it('updates an existing chart and destroys it when its data becomes empty', () => {
    const { common, document, window } = loadCommon();
    const frame = makeElement();
    let empty = null;
    frame.querySelector = () => empty;
    frame.append = (element) => { empty = element; };
    const canvas = makeElement();
    canvas.frame = frame;
    canvas.closest = () => frame;
    document.elements.set('chart', canvas);
    const instances = [];
    window.Chart = class {
      constructor(target, config) {
        this.target = target;
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.updateCount = 0;
        this.destroyCount = 0;
        instances.push(this);
      }
      update() { this.updateCount += 1; }
      destroy() { this.destroyCount += 1; }
    };
    const config = (value) => ({
      type: 'line',
      data: { datasets: [{ data: [value] }] },
      options: {},
    });
    const first = common.renderChart('chart', config(10));
    const updated = common.renderChart('chart', config(20));
    assert.equal(updated, first);
    assert.equal(first.updateCount, 1);
    assert.equal(first.destroyCount, 0);
    assert.equal(first.data.datasets[0].data[0], 20);
    assert.equal(common.renderChart('chart', config(0)), null);
    assert.equal(first.destroyCount, 1);
    assert.equal(canvas.hidden, true);
    assert.equal(empty.textContent, 'No data for this period');
  });

  it('traps modal tab focus, closes on Escape, and restores the opener', () => {
    const { common, document } = loadCommon();
    const opener = makeElement();
    opener.ownerDocument = document;
    document.activeElement = opener;
    const modal = makeElement();
    const dialog = makeElement();
    const first = makeElement();
    const last = makeElement();
    [dialog, first, last].forEach((element) => { element.ownerDocument = document; });
    modal.hidden = true;
    modal.querySelector = (selector) => (
      selector === '[role="dialog"]' ? dialog
        : selector.startsWith('[autofocus]') ? first
          : null
    );
    modal.querySelectorAll = () => [first, last];
    modal.contains = (element) => [modal, dialog, first, last].includes(element);
    common.bindAccessibleModal(modal);
    common.openAccessibleModal(modal);
    assert.equal(modal.hidden, false);
    assert.equal(document.activeElement, first);

    document.activeElement = last;
    let wrapped = false;
    modal.listeners.get('keydown')({
      key: 'Tab',
      shiftKey: false,
      preventDefault() { wrapped = true; },
    });
    assert.equal(wrapped, true);
    assert.equal(document.activeElement, first);

    modal.listeners.get('keydown')({
      key: 'Escape',
      preventDefault() {},
    });
    assert.equal(modal.hidden, true);
    assert.equal(document.activeElement, opener);
  });
});
