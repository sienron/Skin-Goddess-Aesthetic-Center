const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const newsletterRouter = require('../routes/newsletter');
const { migrate } = require('../migrations/045-newsletter-subscribers');

const originalQuery = db.query;
const originalConsoleError = console.error;
const subscribeHandler = newsletterRouter.stack
  .find((layer) => layer.route?.path === '/' && layer.route.methods.post)
  .route.stack.at(-1).handle;

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

async function submit(email) {
  const response = responseCapture();
  await subscribeHandler({ body: { email } }, response);
  return response;
}

test('valid subscription is normalized and saved using a parameterized query', async () => {
  let queryCall;
  db.query = async (sql, values) => {
    queryCall = { sql, values };
    return { rows: [{ subscriber_id: 17 }] };
  };

  try {
    const response = await submit('  Client@Example.COM ');
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.subscribed, true);
    assert.deepEqual(queryCall.values, ['client@example.com']);
    assert.match(queryCall.sql, /INSERT INTO newsletter_subscribers/);
    assert.match(queryCall.sql, /VALUES \(\$1\)/);
    assert.match(queryCall.sql, /ON CONFLICT \(LOWER\(email\)\) DO NOTHING/);
  } finally {
    db.query = originalQuery;
  }
});

test('invalid email is rejected without querying the database', async () => {
  let queryCalled = false;
  db.query = async () => {
    queryCalled = true;
    return { rows: [] };
  };

  try {
    const response = await submit('not-an-email');
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /valid email address/);
    assert.equal(queryCalled, false);
  } finally {
    db.query = originalQuery;
  }
});

test('duplicate subscription receives a friendly response without inserting another row', async () => {
  db.query = async () => ({ rows: [] });

  try {
    const response = await submit('client@example.com');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.alreadySubscribed, true);
    assert.match(response.body.message, /already subscribed/);
  } finally {
    db.query = originalQuery;
  }
});

test('database failure returns a generic server error', async () => {
  db.query = async () => {
    throw new Error('database connection details must not reach the user');
  };
  console.error = () => {};

  try {
    const response = await submit('client@example.com');
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      message: 'We could not subscribe you right now. Please try again.',
    });
    assert.doesNotMatch(JSON.stringify(response.body), /database connection details/);
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }
});

test('migration creates the subscriber table and case-insensitive unique index', async () => {
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };

  try {
    await migrate();
    assert.equal(statements.length, 2);
    assert.match(statements[0], /CREATE TABLE IF NOT EXISTS newsletter_subscribers/);
    assert.match(statements[0], /email VARCHAR\(254\) NOT NULL/);
    assert.match(statements[1], /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(statements[1], /ON newsletter_subscribers \(LOWER\(email\)\)/);
  } finally {
    db.query = originalQuery;
  }
});

test.after(() => {
  db.query = originalQuery;
  console.error = originalConsoleError;
});
