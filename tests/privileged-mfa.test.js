const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../db');
const authRouter = require('../routes/auth');
const { requireRole } = require('../middleware/auth');
const { requirePrivilegedMfa } = require('../middleware/privilegedMfa');
const {
  isPrivilegedRole,
  PRIVILEGED_SESSION_MAX_AGE_MS,
} = require('../utils/privilegedMfa');
const { migrate } = require('../migrations/050-privileged-totp-mfa');
const { issueEnrollmentCode } = require('../scripts/issue-privileged-mfa-enrollment');
const { hashOtpCode } = require('../utils/otpSecurity');
const {
  createTotpSecret,
  codeForStep,
  matchTotpStep,
  encryptTotpSecret,
  decryptTotpSecret,
  hashEnrollmentCode,
} = require('../utils/totp');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalEncryptionKey = process.env.MFA_ENCRYPTION_KEY;
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    message: undefined,
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
    send(message) {
      this.message = message;
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
    session.regenerationCount = (session.regenerationCount || 0) + 1;
    callback(null);
  };
  session.destroy = (callback) => {
    for (const key of Object.keys(session)) {
      if (key !== 'destroy' && key !== 'regenerate') delete session[key];
    }
    callback(null);
  };
  return session;
}

function routeHandler(path, method) {
  const layer = authRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

function authUser(overrides = {}) {
  return {
    user_id: 17,
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
    email_verified: true,
    mfa_enabled: false,
    totp_enabled: true,
    totp_enrolled_at: new Date('2026-11-08T00:00:00.000Z'),
    totp_last_used_step: null,
    ...overrides,
  };
}

test('TOTP matching accepts the current step and rejects malformed/incorrect codes', () => {
  const secret = createTotpSecret();
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 1000 / 30);
  const code = codeForStep(secret, step);
  assert.equal(matchTotpStep(secret, code, now), step);
  assert.equal(matchTotpStep(secret, 'abc123', now), null);
  assert.equal(matchTotpStep(secret, '000000', now), null);
});

test('password login for admin requires TOTP even when local-development MFA bypass is set', async () => {
  const passwordHash = await bcrypt.hash('CorrectHorse!1', 4);
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    return { rows: [authUser({ password_hash: passwordHash, totp_enabled: false })] };
  };
  const req = {
    body: { email: 'admin@example.com', password: 'CorrectHorse!1' },
    headers: { cookie: `sg_remembered_device_17=${'a'.repeat(64)}` },
    session: sessionWith(),
  };
  const response = responseCapture();

  await routeHandler('/login', 'post')(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresMfa, true);
  assert.equal(response.body.mfaMethod, 'enrollment');
  assert.equal(req.session.userId, undefined);
  assert.equal(req.session.pendingPrivilegedMfaUserId, 17);
  assert.equal(req.session.regenerationCount, 1);
  assert.equal(queries.some((sql) => sql.includes('trusted_login_devices')), false);
});

test('production privileged login does not let the survey account bypass TOTP', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDemoBypass = process.env.DEMO_CUSTOMER_MFA_BYPASS;
  process.env.NODE_ENV = 'production';
  process.env.DEMO_CUSTOMER_MFA_BYPASS = 'true';
  const passwordHash = await bcrypt.hash('CorrectHorse!1', 4);
  db.query = async () => ({
    rows: [authUser({
      email: 'demo.client@skingoddess.test',
      role: 'admin',
      password_hash: passwordHash,
      totp_enabled: false,
      mfa_enabled: false,
    })],
  });
  const req = {
    body: { email: 'demo.client@skingoddess.test', password: 'CorrectHorse!1', staysignedin: true },
    headers: {},
    session: sessionWith(),
  };
  const response = responseCapture();

  try {
    await routeHandler('/login', 'post')(req, response);
    assert.equal(response.body.requiresMfa, true);
    assert.equal(response.body.mfaMethod, 'enrollment');
    assert.equal(req.session.userId, undefined);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDemoBypass === undefined) delete process.env.DEMO_CUSTOMER_MFA_BYPASS;
    else process.env.DEMO_CUSTOMER_MFA_BYPASS = originalDemoBypass;
  }
});

test('production does not use mfa_enabled=false as a client email OTP bypass', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDemoBypass = process.env.DEMO_CUSTOMER_MFA_BYPASS;
  process.env.NODE_ENV = 'production';
  delete process.env.DEMO_CUSTOMER_MFA_BYPASS;
  const passwordHash = await bcrypt.hash('CorrectHorse!1', 4);
  db.query = async (sql) => {
    if (sql.includes('SELECT * FROM users')) {
      return {
        rows: [authUser({
          email: 'client@example.com',
          role: 'client',
          mfa_enabled: false,
          password_hash: passwordHash,
        })],
      };
    }
    if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 5 }] };
    return { rows: [] };
  };
  const req = {
    body: { email: 'client@example.com', password: 'CorrectHorse!1' },
    headers: {},
    session: sessionWith(),
  };
  const response = responseCapture();

  try {
    await routeHandler('/login', 'post')(req, response);
    assert.equal(response.statusCode, 429);
    assert.equal(req.session.userId, undefined);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDemoBypass === undefined) delete process.env.DEMO_CUSTOMER_MFA_BYPASS;
    else process.env.DEMO_CUSTOMER_MFA_BYPASS = originalDemoBypass;
  }
});

test('TOTP login succeeds, consumes the step once, and regenerates an MFA-assured session', async () => {
  const secret = createTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const enrolledAt = new Date('2026-11-08T00:00:00.000Z');
  const step = Math.floor(Date.now() / 1000 / 30);
  const user = authUser({
    totp_secret_ciphertext: encrypted.ciphertext,
    totp_secret_iv: encrypted.iv,
    totp_secret_tag: encrypted.tag,
    totp_enrolled_at: enrolledAt,
    totp_last_used_step: null,
  });
  const audited = [];
  db.query = async () => ({ rows: [user] });
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...user }] };
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      if (sql.includes('UPDATE users SET totp_last_used_step')) return { rows: [{ user_id: 17 }] };
      if (sql.includes('INSERT INTO privileged_mfa_audit')) audited.push(values[1]);
      return { rows: [] };
    },
  });
  const req = {
    body: { code: codeForStep(secret, step) },
    session: sessionWith({
      pendingPrivilegedMfaUserId: 17,
      pendingPrivilegedMfaStage: 'totp',
      pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
      pendingPrivilegedMfaStaySignedIn: true,
    }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-totp', 'post')(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, 'admin');
  assert.equal(req.session.userId, 17);
  assert.equal(req.session.mfaVerifiedAt, enrolledAt.getTime());
  assert.ok(Number.isFinite(req.session.privilegedMfaAuthenticatedAt));
  assert.equal(req.session.cookie.maxAge, PRIVILEGED_SESSION_MAX_AGE_MS);
  assert.equal(req.session.staySignedIn, undefined);
  assert.equal(req.session.pendingPrivilegedMfaUserId, undefined);
  assert.equal(req.session.regenerationCount, 1);
  assert.deepEqual(audited, ['login_succeeded']);
});

test('admin and finance TOTP logins never receive persistent sessions', async () => {
  for (const role of ['admin', 'finance_officer']) {
    const secret = createTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    const enrolledAt = new Date();
    const step = Math.floor(Date.now() / 1000 / 30);
    const user = authUser({
      role,
      totp_secret_ciphertext: encrypted.ciphertext,
      totp_secret_iv: encrypted.iv,
      totp_secret_tag: encrypted.tag,
      totp_enrolled_at: enrolledAt,
      totp_last_used_step: null,
    });
    db.query = async () => ({ rows: [user] });
    db.transaction = async (callback) => callback({
      query: async (sql) => {
        if (sql.includes('FOR UPDATE')) return { rows: [{ ...user }] };
        if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
        if (sql.includes('UPDATE users SET totp_last_used_step')) return { rows: [{ user_id: 17 }] };
        return { rows: [] };
      },
    });
    const req = {
      body: { code: codeForStep(secret, step) },
      session: sessionWith({
        pendingPrivilegedMfaUserId: 17,
        pendingPrivilegedMfaStage: 'totp',
        pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
        pendingPrivilegedMfaStaySignedIn: true,
      }),
    };
    const response = responseCapture();

    await routeHandler('/login/verify-totp', 'post')(req, response);

    assert.equal(response.statusCode, 200, role);
    assert.equal(req.session.role, role);
    assert.equal(req.session.staySignedIn, undefined);
    assert.equal(req.session.cookie.maxAge, PRIVILEGED_SESSION_MAX_AGE_MS);
  }
});

test('invalid TOTP is audited and never creates an authenticated session', async () => {
  const secret = createTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const user = authUser({
    totp_secret_ciphertext: encrypted.ciphertext,
    totp_secret_iv: encrypted.iv,
    totp_secret_tag: encrypted.tag,
  });
  const audited = [];
  db.query = async () => ({ rows: [user] });
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...user }] };
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      if (sql.includes('INSERT INTO privileged_mfa_audit')) audited.push(values[1]);
      return { rows: [] };
    },
  });
  const req = {
    body: { code: 'not-a-code' },
    session: sessionWith({
      pendingPrivilegedMfaUserId: 17,
      pendingPrivilegedMfaStage: 'totp',
      pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
    }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-totp', 'post')(req, response);

  assert.equal(response.statusCode, 400);
  assert.equal(req.session.userId, undefined);
  assert.deepEqual(audited, ['login_failed']);
});

test('email OTP cannot authenticate a privileged account via a stale or alternate pending flow', async () => {
  const user = authUser();
  const codeHash = hashOtpCode('123456', user.user_id, 'login_verification');
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      if (sql.includes('SELECT otp_id, code_hash')) return { rows: [{ otp_id: 1, code_hash: codeHash }] };
      return { rows: [] };
    },
  });
  db.query = async () => ({ rows: [user] });
  const req = {
    body: { code: '123456', rememberDevice: true },
    session: sessionWith({ pendingLoginUserId: 17 }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-otp', 'post')(req, response);

  assert.equal(response.statusCode, 403);
  assert.equal(req.session.userId, undefined);
});

test('client email OTP flow remains available without a privileged MFA marker', async () => {
  const user = authUser({ role: 'client', totp_enabled: false });
  const codeHash = hashOtpCode('123456', user.user_id, 'login_verification');
  db.query = async () => ({ rows: [user] });
  db.transaction = async (callback) => callback({
    query: async (sql) => sql.includes('SELECT otp_id, code_hash')
      ? { rows: [{ otp_id: 1, code_hash: codeHash }] }
      : { rows: [] },
  });
  const req = {
    body: { code: '123456' },
    session: sessionWith({ pendingLoginUserId: 17, pendingLoginStaySignedIn: true }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-otp', 'post')(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.role, 'client');
  assert.equal(req.session.userId, 17);
  assert.equal(req.session.mfaVerifiedAt, undefined);
  assert.equal(req.session.staySignedIn, true);
  assert.equal(req.session.cookie.maxAge, 1000 * 60 * 60 * 24 * 400);
});

test('valid recovery code rotates the stored recovery set and authenticates once', async () => {
  const user = authUser({ ...{} });
  const consumedCodes = [];
  let insertedHashes = 0;
  const { hashRecoveryCode } = require('../utils/totp');
  db.query = async () => ({ rows: [user] });
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...user }] };
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      if (sql.includes('UPDATE privileged_mfa_recovery_codes SET used_at')) {
        consumedCodes.push(values[1]);
        return { rows: [{ recovery_code_id: 1 }] };
      }
      if (sql.includes('INSERT INTO privileged_mfa_recovery_codes')) insertedHashes += 1;
      return { rows: [] };
    },
  });
  const req = {
    body: { code: 'A1'.repeat(12) },
    session: sessionWith({
      pendingPrivilegedMfaUserId: 17,
      pendingPrivilegedMfaStage: 'totp',
      pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
    }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-totp', 'post')(req, response);

  assert.equal(response.statusCode, 200);
  assert.equal(req.session.userId, 17);
  assert.equal(response.body.recoveryCodes.length, 10);
  assert.equal(consumedCodes[0], hashRecoveryCode('A1'.repeat(12)));
  assert.equal(insertedHashes, 10);
});

test('privileged MFA verification applies an account-bound failed-attempt limit', async () => {
  const secret = createTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const user = authUser({
    totp_secret_ciphertext: encrypted.ciphertext,
    totp_secret_iv: encrypted.iv,
    totp_secret_tag: encrypted.tag,
  });
  db.query = async () => ({ rows: [user] });
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...user }] };
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 5 }] };
      return { rows: [] };
    },
  });
  const req = {
    body: { code: '123456' },
    session: sessionWith({
      pendingPrivilegedMfaUserId: 17,
      pendingPrivilegedMfaStage: 'totp',
      pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
    }),
  };
  const response = responseCapture();

  await routeHandler('/login/verify-totp', 'post')(req, response);

  assert.equal(response.statusCode, 429);
  assert.equal(req.session.userId, undefined);
});

test('protected API and role middleware deny privileged sessions without current MFA assurance', async () => {
  const user = authUser();
  db.query = async () => ({ rows: [user] });
  let nextCalled = false;
  const request = {
    path: '/finance/reports',
    session: sessionWith({ userId: 17 }),
  };
  const response = responseCapture();
  await requirePrivilegedMfa(request, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);

  const roleResponse = responseCapture();
  await requireRole('admin')({
    session: { userId: 17 },
    originalUrl: '/api/users',
    path: '/users',
    accepts: () => false,
  }, roleResponse, () => { nextCalled = true; });
  assert.equal(roleResponse.statusCode, 403);
  assert.equal(nextCalled, false);

  const assuredSession = {
    userId: 17,
    mfaVerifiedAt: user.totp_enrolled_at.getTime(),
    privilegedMfaAuthenticatedAt: Date.now(),
  };
  let apiAllowed = false;
  await requirePrivilegedMfa({
    path: '/finance/reports',
    session: assuredSession,
  }, responseCapture(), () => { apiAllowed = true; });
  assert.equal(apiAllowed, true);
});

test('privileged MFA assurance expires at the absolute session lifetime', () => {
  const { hasCurrentMfaAssurance } = require('../utils/privilegedMfa');
  const user = authUser();
  assert.equal(hasCurrentMfaAssurance({
    mfaVerifiedAt: user.totp_enrolled_at.getTime(),
    privilegedMfaAuthenticatedAt: Date.now() - PRIVILEGED_SESSION_MAX_AGE_MS,
  }, user), false);
});

test('only administrator and finance roles require privileged TOTP', () => {
  assert.equal(isPrivilegedRole('admin'), true);
  assert.equal(isPrivilegedRole('finance_officer'), true);
  assert.equal(isPrivilegedRole('client'), false);
  assert.equal(isPrivilegedRole('staff'), false);
  assert.equal(isPrivilegedRole('aesthetician'), false);
  assert.equal(isPrivilegedRole('inventory_officer'), false);
});

test('operator-issued enrollment code is required before setup and enrollment activates TOTP', async () => {
  const enrollmentCode = 'AbCdEf0123456789_-AbCdEf01234567';
  const codeRow = {
    enrollment_code_id: 22,
    code_hash: hashEnrollmentCode(enrollmentCode),
    expires_at: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
  };
  let pendingSecret;
  const auditEvents = [];
  db.query = async () => ({ rows: [{ email: 'admin@example.com' }] });
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('UPDATE privileged_mfa_enrollment_codes') && sql.includes('expired_at')) return { rows: [] };
      if (sql.includes('DELETE FROM privileged_mfa_pending_enrollments') && sql.includes('expires_at')) return { rows: [] };
      if (sql.includes('SELECT role, status, email_verified')) return { rows: [{ role: 'admin', status: 'active', email_verified: true }] };
      if (sql.includes('SELECT enrollment_code_id, code_hash')) return { rows: [codeRow] };
      if (sql.includes('INSERT INTO privileged_mfa_pending_enrollments')) {
        pendingSecret = {
          secret_ciphertext: values[1],
          secret_iv: values[2],
          secret_tag: values[3],
        };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO privileged_mfa_audit')) auditEvents.push(values[1]);
      return { rows: [] };
    },
  });
  const startRequest = {
    body: { code: 'wrong' },
    session: sessionWith({
      pendingPrivilegedMfaUserId: 17,
      pendingPrivilegedMfaStage: 'enrollment',
      pendingPrivilegedMfaExpiresAt: Date.now() + 60_000,
    }),
  };
  const startResponse = responseCapture();

  await routeHandler('/mfa/enrollment/start', 'post')(startRequest, startResponse);

  assert.equal(startResponse.statusCode, 400);
  assert.equal(startRequest.session.userId, undefined);
  assert.deepEqual(auditEvents, ['enrollment_failed']);

  startRequest.body.code = enrollmentCode;
  const setupResponse = responseCapture();
  await routeHandler('/mfa/enrollment/start', 'post')(startRequest, setupResponse);
  assert.equal(setupResponse.statusCode, 200);
  assert.match(setupResponse.body.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(typeof setupResponse.body.secret, 'string');
  assert.notEqual(pendingSecret.secret_ciphertext, setupResponse.body.secret);
  assert.equal(decryptTotpSecret({
    ciphertext: pendingSecret.secret_ciphertext,
    iv: pendingSecret.secret_iv,
    tag: pendingSecret.secret_tag,
  }), setupResponse.body.secret);
  assert.equal(startRequest.session.pendingPrivilegedMfaStage, 'enrollment_confirm');

  const createdCodes = [];
  const enrolledAt = new Date();
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('UPDATE privileged_mfa_enrollment_codes') && sql.includes('expired_at')) return { rows: [] };
      if (sql.includes('DELETE FROM privileged_mfa_pending_enrollments') && sql.includes('expires_at')) return { rows: [] };
      if (sql.includes('SELECT user_id, role, status, email_verified')) {
        return { rows: [{ user_id: 17, role: 'admin', status: 'active', email_verified: true }] };
      }
      if (sql.includes('SELECT secret_ciphertext')) {
        return {
          rows: [{
            ...pendingSecret,
            expires_at: new Date(Date.now() + 60_000),
            attempts: 0,
          }],
        };
      }
      if (sql.includes('UPDATE users SET')) {
        return { rows: [{ user_id: 17, role: 'admin', totp_enrolled_at: enrolledAt }] };
      }
      if (sql.includes('INSERT INTO privileged_mfa_recovery_codes')) createdCodes.push(values[1]);
      if (sql.includes('INSERT INTO privileged_mfa_audit')) auditEvents.push(values[1]);
      return { rows: [] };
    },
  });

  const enrollResponse = responseCapture();
  await routeHandler('/mfa/enrollment/verify', 'post')({
    body: { code: codeForStep(setupResponse.body.secret, Math.floor(Date.now() / 1000 / 30)) },
    session: startRequest.session,
  }, enrollResponse);

  assert.equal(enrollResponse.statusCode, 200);
  assert.equal(enrollResponse.body.recoveryCodes.length, 10);
  assert.equal(createdCodes.length, 10);
  assert.equal(startRequest.session.userId, 17);
  assert.equal(startRequest.session.mfaVerifiedAt, enrolledAt.getTime());
  assert.equal(startRequest.session.pendingPrivilegedMfaUserId, undefined);
  assert.ok(auditEvents.includes('enrollment_succeeded'));
});

test('operator enrollment issuance stores only a hashed, expiring, account-bound code', async () => {
  let inserted;
  const auditEvents = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      if (sql.includes('SELECT user_id, role, status')) {
        return { rows: [{ user_id: 17, role: 'finance_officer', status: 'active' }] };
      }
      if (sql.includes('UPDATE privileged_mfa_enrollment_codes') && sql.includes('expired_at')) return { rows: [] };
      if (sql.includes('UPDATE privileged_mfa_enrollment_codes') && sql.includes('revoked_at')) return { rows: [] };
      if (sql.includes('INSERT INTO privileged_mfa_enrollment_codes')) inserted = { sql, values };
      if (sql.includes("'enrollment_code_issued'")) auditEvents.push('enrollment_code_issued');
      return { rows: [] };
    },
  });

  const code = await issueEnrollmentCode(17);

  assert.equal(code.length, 32);
  assert.equal(inserted.values[0], 17);
  assert.equal(inserted.values[1], hashEnrollmentCode(code));
  assert.notEqual(inserted.values[1], code);
  assert.match(inserted.sql, /NOW\(\) \+ INTERVAL '10 minutes'/);
  assert.deepEqual(auditEvents, ['enrollment_code_issued']);
});

test('MFA migration adds separate encrypted factor, enrollment, recovery, and audit storage', async () => {
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };

  await migrate();

  assert.match(statements[0], /totp_secret_ciphertext TEXT/);
  assert.match(statements[0], /totp_last_used_step BIGINT/);
  assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS privileged_mfa_enrollment_codes/.test(sql)));
  assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS privileged_mfa_pending_enrollments/.test(sql)));
  assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS privileged_mfa_recovery_codes/.test(sql)));
  assert.ok(statements.some((sql) => /CREATE TABLE IF NOT EXISTS privileged_mfa_audit/.test(sql)));
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  if (originalEncryptionKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = originalEncryptionKey;
});
