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
  const session = { cookie: {}, ...values };
  session.regenerate = (callback) => {
    const cookie = session.cookie || {};
    for (const key of Object.keys(session)) {
      if (key !== 'regenerate') delete session[key];
    }
    session.cookie = cookie;
    callback(null);
  };
  return session;
}

test('re-registering an unverified email does not persist submitted profile data', async () => {
  sentCodes.length = 0;
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('SELECT user_id, email_verified FROM users')) {
      return { rows: [{ user_id: 17, email_verified: false }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      queries.push(sql);
      if (sql.includes('SELECT registration_id, sent_count')) return { rows: [] };
      if (sql.includes('INSERT INTO pending_registrations')) {
        assert.match(values[0], /^[0-9a-f-]{36}$/i);
        assert.equal(values[1], 'client@example.com');
        assert.match(values[2], /^[a-f0-9]{64}$/);
      }
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
      headers: {},
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, 'If this email can be registered, check your inbox for next steps.');
  assert.ok(session.pendingRegistrationId);
  assert.equal(session.pendingRegistrationProfile.firstName, 'Client');
  assert.equal(session.pendingRegistrationProfile.lastName, 'Example');
  assert.equal(sentCodes.length, 1);
  assert.equal(queries.some((sql) => /users/.test(sql) && /INSERT|UPDATE/.test(sql)), false);
});

test('new registration keeps profile details out of persistent accounts until email verification', async () => {
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('SELECT user_id, email_verified FROM users')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('SELECT registration_id, sent_count')) return { rows: [] };
      return { rows: [] };
    },
  });
  const response = responseCapture();
  const session = sessionWith();

  try {
    await routeHandler('/register', 'post')({
      body: {
        firstName: 'New',
        lastName: 'Client',
        email: 'new-client@example.com',
        password: 'attacker-chosen-password!',
      },
      session,
      headers: {},
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, 'If this email can be registered, check your inbox for next steps.');
  assert.equal(queries.some((sql) => /INSERT INTO users/.test(sql)), false);
  assert.equal(session.pendingRegistrationProfile.firstName, 'New');
  assert.equal(session.pendingRegistrationProfile.lastName, 'Client');
  assert.equal(session.pendingRegistrationProfile.password, undefined);
  assert.ok(session.pendingRegistrationId);
  assert.equal(sentCodes.some(({ email }) => email === 'new-client@example.com'), true);
});

test('verified accounts receive the same generic registration response', async () => {
  db.query = async (sql) => {
    assert.match(sql, /SELECT user_id, email_verified FROM users/);
    return { rows: [{ user_id: 19, email_verified: true }] };
  };
  const response = responseCapture();

  await routeHandler('/register', 'post')({
    body: { firstName: 'Existing', lastName: 'Client', email: 'existing@example.com' },
    session: sessionWith(),
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    message: 'If this email can be registered, check your inbox for next steps.',
  });
});

test('verifying email creates an account only after email ownership is proven', async () => {
  const registrationId = 'c0a80123-4567-489a-bcde-123456789abc';
  const insertedUsers = [];
  const codeHash = hashOtpCode('123456', registrationId, 'email_verification');
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('SELECT registration_id, email, code_hash, attempts')) {
        return {
          rows: [{
            registration_id: registrationId,
            email: 'client@example.com',
            code_hash: codeHash,
            attempts: 0,
          }],
        };
      }
      if (sql.includes('SELECT user_id, email_verified FROM users')) return { rows: [] };
      if (sql.includes('INSERT INTO users')) {
        insertedUsers.push({ sql, values });
        return { rows: [{ user_id: 17 }] };
      }
      return { rows: [] };
    },
  });
  const response = responseCapture();
  const session = sessionWith({
    pendingRegistrationId: registrationId,
    pendingRegistrationProfile: {
      firstName: 'Client',
      lastName: 'Example',
      dob: null,
      gender: null,
      civilStatus: null,
      contactNumber: null,
      address: null,
      allergies: null,
      conditions: null,
    },
  });

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
  assert.equal(session.pendingRegistrationId, undefined);
  assert.equal(session.pendingRegistrationProfile, undefined);
  assert.equal(session.pendingPasswordSetupUserId, 17);
  assert.equal(insertedUsers.length, 1);
  assert.match(insertedUsers[0].sql, /email_verified\)/);
  assert.equal(await bcrypt.compare('attacker-chosen-password!', insertedUsers[0].values[1]), false);
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
