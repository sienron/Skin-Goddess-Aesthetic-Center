const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const usersRouter = require('../routes/users');
const { requireRole } = require('../middleware/auth');
const { requirePrivilegedMfa } = require('../middleware/privilegedMfa');
const { assertValidRuntimeSecurityConfig } = require('../utils/runtimeSecurityConfig');
const { isDemoCustomer } = require('../utils/demoMode');
const { PRIVILEGED_SESSION_MAX_AGE_MS } = require('../utils/privilegedMfa');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalNodeEnv = process.env.NODE_ENV;

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    message: undefined,
    redirectUrl: undefined,
    clearedCookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(message) {
      this.message = message;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookies.push({ name, options });
      return this;
    },
  };
}

function routeHandler(path, method) {
  const layer = usersRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

test('runtime configuration fails closed for missing NODE_ENV and missing production secrets', () => {
  assert.throws(() => assertValidRuntimeSecurityConfig({}), /NODE_ENV must be explicitly set/);
  assert.throws(() => assertValidRuntimeSecurityConfig({ NODE_ENV: 'prod' }), /NODE_ENV must be explicitly set/);
  assert.throws(() => assertValidRuntimeSecurityConfig({ NODE_ENV: 'test' }), /NODE_ENV must be explicitly set/);
  assert.throws(
    () => assertValidRuntimeSecurityConfig({
      NODE_ENV: 'production',
      MFA_ENCRYPTION_KEY: 'm'.repeat(32),
    }),
    /SESSION_SECRET must be configured/
  );
  assert.throws(
    () => assertValidRuntimeSecurityConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(32),
    }),
    /MFA_ENCRYPTION_KEY must be configured/
  );
  assert.throws(
    () => assertValidRuntimeSecurityConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'short',
      MFA_ENCRYPTION_KEY: 'm'.repeat(32),
    }),
    /SESSION_SECRET must contain at least 32 bytes/
  );
  assert.doesNotThrow(() => assertValidRuntimeSecurityConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 's'.repeat(32),
    MFA_ENCRYPTION_KEY: 'm'.repeat(32),
  }));
});

test('production role authorization ignores development access flags', async () => {
  db.query = async () => ({
    rows: [{
      role: 'client',
      status: 'active',
      dev_access_all: true,
      totp_enabled: false,
      totp_enrolled_at: null,
    }],
  });
  for (const nodeEnv of ['production', 'test', undefined]) {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    const response = responseCapture();
    let nextCalled = false;

    await requireRole('admin')({
      session: { userId: 7 },
      originalUrl: '/api/users',
      path: '/users',
      accepts: () => false,
    }, response, () => { nextCalled = true; });

    assert.equal(response.statusCode, 403, String(nodeEnv));
    assert.equal(nextCalled, false, String(nodeEnv));
  }
});

test('survey account exemption is client-only and cannot bypass privileged MFA', () => {
  const env = { NODE_ENV: 'production', DEMO_CUSTOMER_MFA_BYPASS: 'true' };
  assert.equal(isDemoCustomer({
    email: 'demo.client@skingoddess.test',
    role: 'client',
    mfa_enabled: false,
  }, env), true);
  assert.equal(isDemoCustomer({
    email: 'demo.client@skingoddess.test',
    role: 'admin',
    mfa_enabled: false,
  }, env), false);
});

test('suspending an account revokes authenticated and pending sessions transactionally', async () => {
  const queries = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT user_id FROM users')) return { rows: [{ user_id: 7 }] };
      if (sql.includes('UPDATE users SET status')) {
        return {
          rows: [{
            user_id: 7,
            first_name: 'Test',
            last_name: 'User',
            email: 'test@example.com',
            role: 'client',
            status: values[0],
            email_verified: true,
          }],
        };
      }
      return { rows: [] };
    },
  });
  const response = responseCapture();

  await routeHandler('/:id/status', 'patch')({
    params: { id: '7' },
    body: { status: 'suspended' },
  }, response);

  const deleteQuery = queries.find(({ sql }) => sql.includes('DELETE FROM user_sessions'));
  assert.ok(deleteQuery);
  assert.deepEqual(deleteQuery.values, ['7']);
  assert.match(deleteQuery.sql, /sess->>'userId'/);
  assert.match(deleteQuery.sql, /sess->>'pendingLoginUserId'/);
  assert.match(deleteQuery.sql, /sess->>'pendingPrivilegedMfaUserId'/);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'suspended');
});

test('a suspended account with a loaded session is denied and its cookie is cleared', async () => {
  db.query = async () => ({ rows: [{ role: 'client', status: 'suspended' }] });
  const session = {
    userId: 7,
    destroy(callback) {
      this.destroyed = true;
      callback(null);
    },
  };
  const response = responseCapture();
  let nextCalled = false;

  await requirePrivilegedMfa({
    path: '/users',
    session,
  }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.equal(session.destroyed, true);
  assert.equal(response.clearedCookies[0].name, 'connect.sid');
});

test('page role authorization denies a suspended account before granting access', async () => {
  db.query = async () => ({
    rows: [{
      role: 'admin',
      status: 'suspended',
      dev_access_all: false,
      totp_enabled: true,
      totp_enrolled_at: new Date(),
    }],
  });
  const response = responseCapture();
  let nextCalled = false;

  await requireRole('admin')({
    session: { userId: 7 },
    originalUrl: '/AdminDashboard.html',
    path: '/AdminDashboard.html',
    accepts: () => true,
  }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.equal(response.body.message, 'Your account is not active.');
});

test('an expired privileged session is revoked before a protected API can run', async () => {
  db.query = async () => ({
    rows: [{
      role: 'admin',
      status: 'active',
      totp_enabled: true,
      totp_enrolled_at: new Date('2026-11-08T00:00:00.000Z'),
    }],
  });
  const session = {
    userId: 7,
    mfaVerifiedAt: new Date('2026-11-08T00:00:00.000Z').getTime(),
    privilegedMfaAuthenticatedAt: Date.now() - PRIVILEGED_SESSION_MAX_AGE_MS,
    destroy(callback) {
      this.destroyed = true;
      callback(null);
    },
  };
  const response = responseCapture();
  let nextCalled = false;

  await requirePrivilegedMfa({
    path: '/finance/reports',
    session,
  }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
  assert.equal(session.destroyed, true);
});

test('a revoked session cannot reach protected role routes', async () => {
  const response = responseCapture();
  let nextCalled = false;

  await requireRole('admin')({
    session: {},
    accepts: () => false,
  }, response, () => { nextCalled = true; });

  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});
