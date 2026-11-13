const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../db');
const mailer = require('../utils/mailer');
const { hashOtpCode } = require('../utils/otpSecurity');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalSendOtpEmail = mailer.sendOtpEmail;
const sentCodes = [];
mailer.sendOtpEmail = async (email, code) => sentCodes.push({ email, code });
const authRouter = require('../routes/auth');

function routeHandler(path, method) {
  const layer = authRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

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

function sessionWith(values = {}) {
  const session = { ...values };
  session.regenerate = (callback) => {
    for (const key of Object.keys(session)) {
      if (key !== 'regenerate') delete session[key];
    }
    callback(null);
  };
  return session;
}

test('re-registering an unverified email does not save the submitted password', async () => {
  sentCodes.length = 0;
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('SELECT user_id, email_verified FROM users')) {
      return { rows: [{ user_id: 17, email_verified: false }] };
    }
    if (sql.includes('SELECT COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      queries.push(sql);
      return { rows: [] };
    },
  });
  const response = responseCapture();
  const session = sessionWith();

  try {
    await routeHandler('/register', 'post')({
      body: {
        firstName: 'Client',
        lastName: 'Example',
        email: 'client@example.com',
        password: 'attacker-chosen-password!',
      },
      session,
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(session.pendingVerificationUserId, 17);
  assert.equal(sentCodes.length, 1);
  assert.equal(queries.some((sql) => /UPDATE users SET password_hash/.test(sql)), false);
});

test('new registration does not store a submitted password before email verification', async () => {
  let insertedValues;
  db.query = async (sql, values) => {
    if (sql.includes('SELECT user_id, email_verified FROM users')) return { rows: [] };
    if (sql.includes('INSERT INTO users')) {
      insertedValues = values;
      return { rows: [{ user_id: 18, email: 'new-client@example.com' }] };
    }
    if (sql.includes('SELECT COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async () => ({ rows: [] }),
  });
  const response = responseCapture();

  try {
    await routeHandler('/register', 'post')({
      body: {
        firstName: 'New',
        lastName: 'Client',
        email: 'new-client@example.com',
        password: 'attacker-chosen-password!',
      },
      session: sessionWith(),
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 201);
  assert.ok(insertedValues);
  assert.equal(typeof insertedValues[1], 'string');
  assert.equal(await bcrypt.compare('attacker-chosen-password!', insertedValues[1]), false);
  assert.equal(sentCodes.some(({ email }) => email === 'new-client@example.com'), true);
});

test('verifying email invalidates every pre-verification password and requires password setup', async () => {
  const savedPasswordHashes = [];
  const codeHash = hashOtpCode('123456', 17, 'email_verification');
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('SELECT otp_id, code_hash, attempts')) {
        return { rows: [{ otp_id: 1, code_hash: codeHash, attempts: 0 }] };
      }
      if (sql.includes('UPDATE users SET email_verified = TRUE, password_hash')) {
        savedPasswordHashes.push(values[1]);
      }
      return { rows: [] };
    },
  });
  const response = responseCapture();
  const session = sessionWith({ pendingVerificationUserId: 17 });

  try {
    await routeHandler('/verify-otp', 'post')({
      body: { code: '123456' },
      session,
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPasswordSetup, true);
  assert.equal(session.pendingVerificationUserId, undefined);
  assert.equal(session.pendingPasswordSetupUserId, 17);
  assert.equal(savedPasswordHashes.length, 1);
  assert.equal(await bcrypt.compare('attacker-chosen-password!', savedPasswordHashes[0]), false);
});

test('verified email owner can finish registration with a new password', async () => {
  let savedPasswordHash;
  db.query = async (sql, values) => {
    assert.match(sql, /role = 'client' AND status = 'active' AND email_verified = TRUE/);
    savedPasswordHash = values[0];
    return { rows: [{ user_id: 17 }] };
  };
  const response = responseCapture();
  const session = sessionWith({ pendingPasswordSetupUserId: 17 });

  await routeHandler('/complete-registration', 'post')({
    body: { password: 'new-client-password1!' },
    session,
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(session.pendingPasswordSetupUserId, undefined);
  assert.equal(await bcrypt.compare('new-client-password1!', savedPasswordHash), true);
});

test('registration completion rejects passwords without a number', async () => {
  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    return { rows: [] };
  };
  const response = responseCapture();

  await routeHandler('/complete-registration', 'post')({
    body: { password: 'new-client-password!' },
    session: sessionWith({ pendingPasswordSetupUserId: 17 }),
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /one number/i);
  assert.equal(queryCount, 0);
});

test('registration status supports resuming password setup without exposing account details', async () => {
  const response = responseCapture();

  await routeHandler('/registration-status', 'get')({
    session: sessionWith({ pendingPasswordSetupUserId: 17 }),
  }, response);

  assert.equal(response.body.requiresPasswordSetup, true);
  assert.equal(Object.hasOwn(response.body, 'userId'), false);
});

test('registration completion requires email verification and a valid password', async () => {
  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    return { rows: [] };
  };
  const response = responseCapture();

  await routeHandler('/complete-registration', 'post')({
    body: { password: 'invalid' },
    session: sessionWith({ pendingPasswordSetupUserId: 17 }),
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  mailer.sendOtpEmail = originalSendOtpEmail;
});
