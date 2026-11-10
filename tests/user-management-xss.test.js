const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../db');
const authRouter = require('../routes/auth');
const usersRouter = require('../routes/users');
const { isValidEmail, isValidName } = require('../utils/userValidation');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const maliciousValues = [
  '<script>alert(1)</script>',
  '" autofocus onfocus="alert(1)',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
];

function responseCapture() {
  return {
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
}

function routeHandler(router, path, method) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.className = '';
    this._text = '';
    this.dataset = new Proxy({}, {
      get: (_target, key) => this.attributes[`data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`],
    });
    const element = this;
    this.classList = {
      add(name) {
        if (!this.contains(name)) element.className = `${element.className} ${name}`.trim();
      },
      remove(name) {
        element.className = element.className.split(/\s+/).filter((item) => item !== name).join(' ');
      },
      contains(name) {
        return element.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !this.contains(name) : force;
        if (shouldAdd) this.add(name);
        else this.remove(name);
        return shouldAdd;
      },
    };
  }

  set textContent(value) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this._text = String(value ?? '');
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this._text = '';
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  querySelector(selector) {
    const matches = (element) => selector.startsWith('.')
      ? element.classList.contains(selector.slice(1))
      : selector === 'tr' && element.tagName === 'TR';
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child)) return child;
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }

  closest(selector) {
    let element = this;
    while (element) {
      if (selector === '[data-action]' && element.attributes['data-action']) return element;
      if (selector === '.um-tab' && element.classList.contains('um-tab')) return element;
      if (selector === 'tr' && element.tagName === 'TR') return element;
      element = element.parentElement;
    }
    return null;
  }

  querySelectorAll() {
    return [];
  }

  showModal() { this.open = true; }
  close() { this.open = false; }
  click() {
    if (this.listeners.click) this.listeners.click({ target: this, preventDefault() {} });
  }
}

function getOrCreateElement(elements, id) {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
}

async function renderWithUser(user) {
  const elements = new Map();
  const document = {
    getElementById: (id) => getOrCreateElement(elements, id),
    createElement: (tagName) => new FakeElement(tagName),
    querySelector: () => null,
    addEventListener() {},
  };
  const window = {
    location: { search: '', pathname: '/Usermanagement.html' },
    history: { replaceState() {} },
  };
  const script = fs.readFileSync(require.resolve('../Usermanagement.js'), 'utf8');
  const context = vm.createContext({
    document,
    window,
    URLSearchParams,
    fetch: async (url) => ({
      ok: true,
      status: 200,
      json: async () => url === '/api/users/stats'
        ? { total: 1, clients: 1, staff: 0, suspended: 0 }
        : url.startsWith('/api/users?')
          ? { users: [user], total: 1 }
          : user,
    }),
    console,
    setTimeout,
    clearTimeout,
    alert() {},
  });
  vm.runInContext(script, context, { filename: 'Usermanagement.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return { elements };
}

function findElement(root, selector) {
  if (selector.startsWith('.')) {
    if (root.classList.contains(selector.slice(1))) return root;
  }
  for (const child of root.children) {
    const match = findElement(child, selector);
    if (match) return match;
  }
  return null;
}

test('malicious stored values remain text in table rows and edit-user controls', async () => {
  const source = fs.readFileSync(require.resolve('../Usermanagement.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);

  for (const value of maliciousValues) {
    const user = {
      id: 42,
      fullName: value,
      initials: '<x>',
      role: 'client',
      roleLabel: 'CLIENT',
      email: value,
      sex: '',
      status: 'active',
      address: value,
      contact: value,
      joined: null,
      dob: null,
      allergies: [],
    };
    const { elements } = await renderWithUser(user);
    const tableBody = elements.get('umTableBody');
    const row = tableBody.children[0];
    assert.equal(findElement(row, '.um-user-cell__name').textContent, value);
    assert.equal(row.children[3].textContent, value);
    const checkbox = row.children[0].children[0];
    const deleteButton = findElement(row, '.um-action--danger');
    assert.equal(checkbox.getAttribute('aria-label'), `Select ${value}`);
    assert.equal(deleteButton.getAttribute('aria-label'), `Delete ${value}`);

    const viewButton = row.children.at(-1).querySelector('.um-action--view');
    await tableBody.listeners.click({
      target: viewButton,
      preventDefault() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    elements.get('umModalEditBtn').click();

    for (const id of ['umPiFullName', 'umPiEmail', 'umPiAddress', 'umPiContact']) {
      const input = elements.get(id).children[0];
      assert.equal(input.value, value);
      assert.equal(Object.keys(input.attributes).some((name) => /^on/i.test(name)), false);
    }
  }
});

test('name validation and rendering preserve common and international legitimate names', async () => {
  for (const name of ["Mary Jane O'Neil-Santos", 'José Núñez', 'Anne-Marie', '李 小龍', 'D’Arcy Smith', 'Jean・Luc']) {
    assert.equal(isValidName(name), true, `${name} should be accepted`);
  }
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('"><svg onload=alert(1)>@example.com'), false);

  const name = "Mary Jane O'Neil-Santos";
  const user = {
    id: 8,
    fullName: name,
    initials: 'MO',
    role: 'client',
    roleLabel: 'CLIENT',
    email: 'mary@example.com',
    sex: '',
    status: 'active',
    address: '',
    contact: '',
    joined: null,
    dob: null,
    allergies: [],
  };
  const { elements } = await renderWithUser(user);
  const tableBody = elements.get('umTableBody');
  const row = tableBody.children[0];
  assert.equal(findElement(row, '.um-user-cell__name').textContent, name);
  await tableBody.listeners.click({
    target: row.querySelector('.um-action--view'),
    preventDefault() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  elements.get('umModalEditBtn').click();
  assert.equal(elements.get('umPiFullName').children[0].value, name);
});

test('registration rejects malformed names and email before touching storage', async () => {
  const handler = routeHandler(authRouter, '/register', 'post');
  for (const firstName of maliciousValues) {
    let queried = false;
    db.query = async () => { queried = true; return { rows: [] }; };
    const response = responseCapture();
    await handler({
      body: { firstName, lastName: 'Smith', email: 'person@example.com', password: 'Password!1' },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(queried, false);
  }

  const response = responseCapture();
  db.query = async () => ({ rows: [] });
  await handler({
    body: { firstName: 'Jane', lastName: 'Smith', email: 'invalid-email', password: 'Password!1' },
  }, response);
  assert.equal(response.statusCode, 400);
});

test('admin create and update routes reject malformed names and email before storage', async () => {
  const createHandler = routeHandler(usersRouter, '/', 'post');
  const updateHandler = routeHandler(usersRouter, '/:id', 'put');
  for (const value of maliciousValues) {
    let queried = false;
    db.query = async () => { queried = true; return { rows: [] }; };
    const createResponse = responseCapture();
    await createHandler({
      body: { fullName: value, email: 'person@example.com', role: 'client' },
    }, createResponse);
    assert.equal(createResponse.statusCode, 400);
    assert.equal(queried, false);

    const updateResponse = responseCapture();
    await updateHandler({
      body: { fullName: value, email: 'person@example.com' },
      params: { id: '42' },
    }, updateResponse);
    assert.equal(updateResponse.statusCode, 400);
    assert.equal(queried, false);
  }

  const invalidEmailResponse = responseCapture();
  await updateHandler({
    body: { fullName: 'Jane Smith', email: 'not-an-email' },
    params: { id: '42' },
  }, invalidEmailResponse);
  assert.equal(invalidEmailResponse.statusCode, 400);
  const invalidCreateEmail = responseCapture();
  await createHandler({
    body: { fullName: 'Jane Smith', email: '"><svg onload=alert(1)>@example.com', role: 'client' },
  }, invalidCreateEmail);
  assert.equal(invalidCreateEmail.statusCode, 400);
});

test('admin create and update routes preserve valid names and normalize email', async () => {
  const createHandler = routeHandler(usersRouter, '/', 'post');
  const updateHandler = routeHandler(usersRouter, '/:id', 'put');
  const savedUser = {
    user_id: 42,
    first_name: 'Mary',
    last_name: "O'Neil-Santos",
    email: 'mary@example.com',
    role: 'client',
    status: 'active',
    created_at: null,
    updated_at: null,
  };
  let insertedValues;
  db.query = async (sql, values) => {
    if (sql.startsWith('SELECT user_id FROM users')) return { rows: [] };
    insertedValues = values;
    return { rows: [savedUser] };
  };

  const createResponse = responseCapture();
  await createHandler({
    body: { fullName: "Mary O'Neil-Santos", email: ' Mary@Example.com ', role: 'client' },
  }, createResponse);
  assert.equal(createResponse.statusCode, 201);
  assert.equal(insertedValues[0], 'mary@example.com');
  assert.equal(typeof insertedValues[1], 'string');
  assert.equal(insertedValues[2], 'Mary');
  assert.equal(insertedValues[3], "O'Neil-Santos");
  assert.equal(createResponse.body.user.fullName, "Mary O'Neil-Santos");

  db.query = async (_sql, values) => {
    insertedValues = values;
    return { rows: [savedUser] };
  };
  db.transaction = async (callback) => callback({ query: db.query });
  const updateResponse = responseCapture();
  await updateHandler({
    body: { fullName: "Mary O'Neil-Santos", email: ' Mary@Example.com ' },
    params: { id: '42' },
  }, updateResponse);
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(insertedValues[0], 'Mary');
  assert.equal(insertedValues[1], "O'Neil-Santos");
  assert.equal(insertedValues[2], 'mary@example.com');
});

test('account profile and email-change endpoints reject malformed values', async () => {
  const profileHandler = routeHandler(authRouter, '/update-profile', 'put');
  const emailChangeHandler = routeHandler(authRouter, '/request-email-change', 'post');

  for (const firstName of maliciousValues) {
    let queried = false;
    db.query = async () => { queried = true; return { rows: [] }; };
    const response = responseCapture();
    await profileHandler({
      body: { firstName, lastName: 'Smith' },
      session: { userId: 7 },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(queried, false);
  }

  const emailResponse = responseCapture();
  await emailChangeHandler({
    body: { newEmail: '"><svg onload=alert(1)>@example.com' },
    session: { userId: 7 },
  }, emailResponse);
  assert.equal(emailResponse.statusCode, 400);
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
});
