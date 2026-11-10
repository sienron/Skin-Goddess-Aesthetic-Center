const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../db');
const inventoryRouter = require('../routes/inventory');

const originalQuery = db.query;

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.className = '';
    this.attributes = {};
    this._text = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    throw new Error('Inventory renderer must not parse HTML.');
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this._text = String(value ?? '');
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

function routeHandler(pathname, method) {
  const layer = inventoryRouter.stack.find((item) => item.route?.path === pathname && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${pathname} route`);
  return layer.route.stack.at(-1).handle;
}

function createRenderer() {
  const context = {
    document: {
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (text) => new FakeTextNode(text),
    },
  };
  context.window = context;
  const source = fs.readFileSync(path.join(__dirname, '..', 'inventory-row-renderer.js'), 'utf8');
  vm.runInNewContext(source, context);
  return context.InventoryRowRenderer;
}

test.after(() => {
  db.query = originalQuery;
});

test('stored malicious inventory names and categories are rendered as inert text', () => {
  const values = [
    '<script>alert(1)</script>',
    '" autofocus onfocus="alert(1)',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
  ];
  const documentTags = [];
  function collectTags(element) {
    if (element.tagName) documentTags.push(element.tagName);
    if (Array.isArray(element.children)) element.children.forEach(collectTags);
  }
  const row = createRenderer().createInventoryProductRow({
    product_id: 1,
    product_name: `${values[0]} ${values[1]}`,
    category: `${values[2]} ${values[3]}`,
    stock_quantity: 4,
    expiry_date: null,
  }, 'low', 'Low Stock');
  const renderedText = row.textContent;
  collectTags(row);

  values.forEach((value) => assert.ok(renderedText.includes(value)));
  assert.ok(renderedText.includes('Low Stock'.toUpperCase()));
  assert.equal(row.children.length, 6);
  assert.equal(documentTags.some((tag) => ['SCRIPT', 'IMG', 'SVG'].includes(tag)), false);
  assert.equal(row.dataset.category, `${values[2]} ${values[3]}`);
  assert.equal(Object.keys(row.attributes).some((name) => /^on/i.test(name)), false);
});

test('invoice OCR review uses text and value properties for extracted values', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'batch-upload.js'), 'utf8');
  assert.match(source, /input\.value = value \?\? ""/);
  assert.match(source, /rawText\.textContent = result\.rawText \|\| ""/);
  const staticModalTemplate = source.match(/modal\.innerHTML = `([\s\S]*?)`;/)?.[1];
  assert.ok(staticModalTemplate);
  assert.doesNotMatch(staticModalTemplate, /\$\{/);
});

test('inventory product creation rejects overlong or malformed user-controlled fields server-side', async () => {
  let databaseTouched = false;
  db.query = async () => {
    databaseTouched = true;
    return { rows: [] };
  };
  const invalidBodies = [
    { product_name: 'x'.repeat(256), category: 'Soaps & Cleansers', stock: 1 },
    { product_name: 'Serum', category: 4, stock: 1 },
    { product_name: 'Serum', category: 'x'.repeat(101), stock: 1 },
    { product_name: 'Serum', category: 'Soaps & Cleansers', stock: 1, expiry_date: '2026-02-31' },
  ];

  for (const [pathname, method, body] of [
    ...invalidBodies.map((body) => ['/', 'post', body]),
    ...invalidBodies.map((body) => ['/:id', 'put', { ...body, stock_adjustment: 0 }]),
  ]) {
    const response = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await routeHandler(pathname, method)({
      body,
      params: { id: '1' },
      session: { userId: 7 },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.ok(response.body.message);
  }
  assert.equal(databaseTouched, false);
});
