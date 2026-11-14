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
const originalSendNotificationEmail = mailer.sendNotificationEmail;
const originalCompare = bcrypt.compare;
const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'otp-security-regression-test-secret';
const deliveredOtpEmails = [];
const sentNotifications = [];
mailer.sendOtpEmail = async (email, code) => deliveredOtpEmails.push({ email, code });
mailer.sendNotificationEmail = async (...args) => sentNotifications.push(args);
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

  assert.equal(comparedHashes.length, 3);
  assert.notEqual(comparedHashes[0], comparedHashes[1]);
  assert.equal(comparedHashes[0], comparedHashes[2]);
  assert.match(comparedHashes[0], /^\$2[aby]\$12\$/);
});

test('non-privileged staff accounts must complete email OTP before signing in', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const passwordHash = await bcrypt.hash('correct-password', 12);
  const user = {
    user_id: 45,
    email: 'aesthetician@example.com',
    password_hash: passwordHash,
    role: 'aesthetician',
    status: 'active',
    email_verified: true,
    mfa_enabled: false,
    totp_enabled: false,
  };
  deliveredOtpEmails.length = 0;
  db.query = async (sql) => {
    if (sql.includes('SELECT * FROM users')) return { rows: [user] };
    if (sql.includes('SELECT locked_until FROM login_failures')) return { rows: [] };
    if (sql.includes('DELETE FROM login_failures')) return { rows: [] };
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async () => ({ rows: [] }),
  });
  const session = sessionWith();
  const response = responseCapture();

  try {
    await routeHandler('/login', 'post')({
      body: { email: user.email, password: 'correct-password' },
      headers: {},
      session,
    }, response);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresMfa, true);
  assert.equal(response.body.mfaMethod, 'email_otp');
  assert.equal(session.userId, undefined);
  assert.equal(session.pendingLoginUserId, user.user_id);
  assert.equal(deliveredOtpEmails.length, 1);
});

test('known-account login failures are counted and a temporary lockout stays generic', async () => {
  const passwordHash = await bcrypt.hash('correct-password', 12);
  const user = {
    user_id: 46,
    email: 'locked@example.com',
    password_hash: passwordHash,
  };
  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('SELECT * FROM users')) return { rows: [user] };
    if (sql.includes('SELECT locked_until FROM login_failures')) return { rows: [] };
    if (sql.includes('INSERT INTO login_failures')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const response = responseCapture();

  try {
    await routeHandler('/login', 'post')({
      body: { email: user.email, password: 'wrong-password' },
    }, response);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { message: 'Incorrect email or password.' });
  const failureWrite = queries.find(({ sql }) => sql.includes('INSERT INTO login_failures'));
  assert.ok(failureWrite);
  assert.deepEqual(failureWrite.values, [user.user_id, 10]);
  assert.match(failureWrite.sql, /15 minutes/);

  db.query = async (sql) => {
    if (sql.includes('SELECT * FROM users')) return { rows: [user] };
    if (sql.includes('SELECT locked_until FROM login_failures')) {
      return { rows: [{ locked_until: new Date(Date.now() + 60_000) }] };
    }
    throw new Error(`Unexpected query during lockout: ${sql}`);
  };
  const lockedResponse = responseCapture();
  try {
    await routeHandler('/login', 'post')({
      body: { email: user.email, password: 'correct-password' },
    }, lockedResponse);
  } finally {
    db.query = originalQuery;
  }
  assert.equal(lockedResponse.statusCode, 401);
  assert.deepEqual(lockedResponse.body, { message: 'Incorrect email or password.' });
});

test('client email OTP is stored only as a hash, invalidates the previous code, and remains single-use', async () => {
  const originalPasswordHash = await bcrypt.hash('correct-password', 10);
  deliveredOtpEmails.length = 0;
  const statements = [];
  const passwordUpgradeStatements = [];
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
    if (sql.includes('SELECT locked_until FROM login_failures')) return { rows: [] };
    if (sql.includes('DELETE FROM login_failures')) return { rows: [] };
    if (sql.includes('UPDATE users SET password_hash')) {
      passwordUpgradeStatements.push(sql);
      return { rows: [], rowCount: 1 };
    }
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
    assert.equal(passwordUpgradeStatements.length, 1);
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
      pendingLoginExpiresAt: Date.now() + 10 * 60 * 1000,
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

test('email-change OTP requires the current password and is stored only as an account-bound hash', async () => {
  deliveredOtpEmails.length = 0;
  const statements = [];
  const passwordHash = await bcrypt.hash('correct-password', 12);
  db.query = async (sql) => {
    if (sql.includes('SELECT email, password_hash FROM users')) {
      return { rows: [{ email: 'old@example.com', password_hash: passwordHash }] };
    }
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
  const session = sessionWith({ userId: 31 });

  try {
    await routeHandler('/request-email-change', 'post')({
      body: { newEmail: 'new@example.com', currentPassword: 'correct-password' },
      session,
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
    assert.equal(statements.length, 3);
    assert.equal(session.pendingEmailChangeReauthEmail, 'new@example.com');

    const resendResponse = responseCapture();
    await routeHandler('/request-email-change', 'post')({
      body: { newEmail: 'new@example.com' },
      session,
    }, resendResponse);
    assert.equal(resendResponse.statusCode, 200);
    assert.equal(deliveredOtpEmails.length, 2);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('email-change request rejects missing or incorrect current passwords', async () => {
  const passwordHash = await bcrypt.hash('correct-password', 12);
  db.query = async (sql) => {
    if (sql.includes('SELECT email, password_hash FROM users')) {
      return { rows: [{ email: 'old@example.com', password_hash: passwordHash }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  for (const body of [
    { newEmail: 'new@example.com' },
    { newEmail: 'new@example.com', currentPassword: 'wrong-password' },
  ]) {
    const response = responseCapture();
    await routeHandler('/request-email-change', 'post')({
      body,
      session: sessionWith({ userId: 31 }),
    }, response);
    assert.equal(response.statusCode, body.currentPassword ? 401 : 400);
  }
});

test('confirming an email change sends a notification to the old address', async () => {
  sentNotifications.length = 0;
  const codeHash = hashOtpCode('654321', 31, 'email_change');
  const statements = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      statements.push({ sql, values });
      if (sql.includes('SELECT change_id, new_email, code_hash')) {
        return { rows: [{ change_id: 5, new_email: 'new@example.com', code_hash: codeHash }] };
      }
      if (sql.includes('SELECT user_id FROM users')) return { rows: [] };
      if (sql.includes('SELECT email FROM users')) return { rows: [{ email: 'old@example.com' }] };
      return { rows: [] };
    },
  });
  const response = responseCapture();
  const session = sessionWith({ userId: 31, pendingEmailChangeReauthEmail: 'new@example.com' });

  try {
    await routeHandler('/confirm-email-change', 'post')({
      body: { code: '654321' },
      session,
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(sentNotifications[0][0], 'old@example.com');
  assert.equal(sentNotifications[0][1], 'email_changed');
  assert.match(sentNotifications[0][2], /If you did not make this change/);
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE users SET email')));
  assert.equal(session.pendingEmailChangeReauthEmail, undefined);
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
  mailer.sendNotificationEmail = originalSendNotificationEmail;
  bcrypt.compare = originalCompare;
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});
