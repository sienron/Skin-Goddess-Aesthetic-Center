const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../db');
const mailer = require('../utils/mailer');
const {
  hashOtpCode,
  verifyOtpCode,
} = require('../utils/otpSecurity');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalSendOtpEmail = mailer.sendOtpEmail;
const originalCompare = bcrypt.compare;
const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'otp-security-regression-test-secret';
const deliveredOtpEmails = [];
mailer.sendOtpEmail = async (email, code) => deliveredOtpEmails.push({ email, code });
const authRouter = require('../routes/auth');
const { migrate } = require('../migrations/051-hashed-email-otps');

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
    clearCookie() {
      return this;
    },
  };
}

function sessionWith(values = {}) {
  const session = { ...values, cookie: {} };
  session.regenerate = (callback) => {
    for (const key of Object.keys(session)) {
      if (key !== 'regenerate') delete session[key];
    }
    session.cookie = {};
    callback(null);
  };
  return session;
}

test('OTP hashes are keyed, account- and purpose-bound, and verified in constant-time-safe format', () => {
  const hash = hashOtpCode('123456', 12, 'login_verification');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, '123456');
  assert.equal(verifyOtpCode('123456', hash, 12, 'login_verification'), true);
  assert.equal(verifyOtpCode('123457', hash, 12, 'login_verification'), false);
  assert.equal(verifyOtpCode('123456', hash, 13, 'login_verification'), false);
  assert.equal(verifyOtpCode('123456', hash, 12, 'email_verification'), false);
  assert.equal(verifyOtpCode('123456', 'not-a-hash', 12, 'login_verification'), false);
});

test('password login performs bcrypt comparison for unknown and existing emails with the same generic error', async () => {
  const login = routeHandler('/login', 'post');
  const comparedHashes = [];
  bcrypt.compare = async (password, passwordHash) => {
    comparedHashes.push(passwordHash);
    return originalCompare(password, passwordHash);
  };
  const knownUser = {
    user_id: 44,
    email: 'known@example.com',
    password_hash: await bcrypt.hash('correct-password', 10),
  };

  try {
    for (const rows of [[], [knownUser]]) {
      db.query = async () => ({ rows });
      const response = responseCapture();
      await login({
        body: { email: rows.length ? knownUser.email : 'unknown@example.com', password: 'wrong-password' },
      }, response);
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.body, { message: 'Incorrect email or password.' });
    }
  } finally {
    bcrypt.compare = originalCompare;
    db.query = originalQuery;
  }

  assert.equal(comparedHashes.length, 2);
  assert.notEqual(comparedHashes[0], comparedHashes[1]);
  assert.match(comparedHashes[0], /^\$2[aby]\$10\$/);
});

test('client email OTP is stored only as a hash, invalidates the previous code, and remains single-use', async () => {
  const originalPasswordHash = await bcrypt.hash('correct-password', 10);
  deliveredOtpEmails.length = 0;
  const statements = [];
  const user = {
    user_id: 31,
    email: 'client@example.com',
    password_hash: originalPasswordHash,
    role: 'client',
    status: 'active',
    email_verified: true,
    totp_enabled: false,
  };
  bcrypt.compare = originalCompare;
  db.query = async (sql) => {
    if (sql.includes('SELECT * FROM users')) return { rows: [user] };
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO otp_codes')) {
        assert.equal(values[0], user.user_id);
        assert.equal(values[2], 'login_verification');
        assert.equal(verifyOtpCode(deliveredOtpEmails[0]?.code || '000000', values[1], user.user_id, 'login_verification'), false);
        return { rows: [] };
      }
      return { rows: [] };
    },
  });
  const loginResponse = responseCapture();
  const loginSession = sessionWith();

  try {
    await routeHandler('/login', 'post')({
      body: { email: user.email, password: 'correct-password' },
      session: loginSession,
      headers: {},
    }, loginResponse);

    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.body.requiresMfa, true);
    assert.equal(Object.hasOwn(loginResponse.body, 'code'), false);
    assert.equal(loginSession.pendingLoginUserId, user.user_id);
    assert.equal(deliveredOtpEmails.length, 1);
    assert.equal(deliveredOtpEmails[0].email, user.email);
    assert.equal(statements.length, 3);
    assert.match(statements[0].sql, /pg_advisory_xact_lock/);
    assert.match(statements[1].sql, /UPDATE otp_codes SET is_used = TRUE/);
    assert.match(statements[2].sql, /INSERT INTO otp_codes \(user_id, code_hash, purpose, expires_at\)/);
    assert.equal(statements[2].values[1].length, 64);
    assert.notEqual(statements[2].values[1], deliveredOtpEmails[0].code);
    assert.equal(verifyOtpCode(deliveredOtpEmails[0].code, statements[2].values[1], user.user_id, 'login_verification'), true);

    let consumed = false;
    db.transaction = async (callback) => callback({
      query: async (sql) => {
        if (sql.includes('SELECT otp_id, code_hash')) {
          return {
            rows: [{
              otp_id: 8,
              code_hash: statements[2].values[1],
            }],
          };
        }
        if (sql.includes('UPDATE otp_codes SET is_used = TRUE WHERE otp_id')) {
          consumed = true;
        }
        return { rows: [] };
      },
    });
    db.query = async (sql) => {
      if (sql.includes('SELECT user_id, role, status, email_verified')) return { rows: [user] };
      throw new Error(`Unexpected query: ${sql}`);
    };
    const verifyResponse = responseCapture();
    const verifySession = sessionWith({
      pendingLoginUserId: user.user_id,
      pendingLoginStaySignedIn: false,
    });
    await routeHandler('/login/verify-otp', 'post')({
      body: { code: deliveredOtpEmails[0].code },
      session: verifySession,
    }, verifyResponse);

    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(verifySession.userId, user.user_id);
    assert.equal(consumed, true);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    mailer.sendOtpEmail = originalSendOtpEmail;
    bcrypt.compare = originalCompare;
  }
});

test('email-change OTP replaces prior pending codes and is stored only as an account-bound hash', async () => {
  deliveredOtpEmails.length = 0;
  const statements = [];
  db.query = async (sql) => {
    if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'old@example.com' }] };
    if (sql.includes('SELECT user_id FROM users')) return { rows: [] };
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      statements.push({ sql, values });
      return { rows: [] };
    },
  });
  const response = responseCapture();

  try {
    await routeHandler('/request-email-change', 'post')({
      body: { newEmail: 'new@example.com' },
      session: sessionWith({ userId: 31 }),
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(Object.hasOwn(response.body, 'code'), false);
    assert.equal(deliveredOtpEmails.length, 1);
    assert.equal(deliveredOtpEmails[0].email, 'new@example.com');
    assert.match(statements[0].sql, /pg_advisory_xact_lock/);
    assert.match(statements[1].sql, /UPDATE pending_email_changes SET is_used = TRUE/);
    assert.match(statements[2].sql, /INSERT INTO pending_email_changes \(user_id, new_email, code_hash, expires_at\)/);
    assert.equal(statements[2].values[1], 'new@example.com');
    assert.notEqual(statements[2].values[2], deliveredOtpEmails[0].code);
    assert.equal(verifyOtpCode(
      deliveredOtpEmails[0].code,
      statements[2].values[2],
      31,
      'email_change',
    ), true);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('OTP schema migration invalidates existing plaintext codes and removes the plaintext columns', async () => {
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };

  try {
    await migrate();
  } finally {
    db.query = originalQuery;
  }

  assert.equal(statements.length, 8);
  assert.match(statements[0], /ADD COLUMN IF NOT EXISTS code_hash VARCHAR\(64\)/);
  assert.match(statements[1], /SET code_hash = COALESCE\(code_hash, repeat\('0', 64\)\), is_used = TRUE/);
  assert.match(statements[3], /DROP COLUMN IF EXISTS code/);
  assert.match(statements[4], /pending_email_changes ADD COLUMN IF NOT EXISTS code_hash/);
  assert.match(statements[5], /UPDATE pending_email_changes/);
  assert.match(statements[7], /pending_email_changes DROP COLUMN IF EXISTS code/);
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  mailer.sendOtpEmail = originalSendOtpEmail;
  bcrypt.compare = originalCompare;
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});
