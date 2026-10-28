const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEMO_CUSTOMER_EMAIL,
  assertDemoCustomerExternalOperationAllowed,
  assertValidDemoCustomerConfiguration,
  isDemoCustomer,
} = require('../utils/demoMode');
const { getPayMongoConfig } = require('../utils/paymongoConfig');
const { hasRoleAccess } = require('../utils/roleAccess');
const {
  assertConnectedDemoDatabaseTarget,
  assertDemoDatabaseTargetConfigured,
} = require('../utils/demoDatabaseTarget');
const {
  createBlockDemoCustomerPayments,
  createPreserveDemoCustomerAccess,
} = require('../utils/demoCustomerAccess');
const {
  CUSTOMER_APPOINTMENTS_QUERY,
  loadCustomerAppointmentHistory,
} = require('../utils/customerAppointmentHistory');
const { STAFF_ROLES } = require('../utils/roleRoutes');
const { createSecureCredentialFile } = require('../utils/secureCredentialFile');
const mailer = require('../utils/mailer');
const packageJson = require('../package.json');

const demoEnv = {
  NODE_ENV: 'production',
  DEMO_CUSTOMER_MFA_BYPASS: 'true',
};

const demoCustomer = {
  email: DEMO_CUSTOMER_EMAIL,
  role: 'client',
  mfa_enabled: false,
};

function createResponse() {
  return {
    statusCode: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('only the exact customer account receives the configured MFA exemption', () => {
  assert.equal(isDemoCustomer(demoCustomer, demoEnv), true);

  for (const [user, env] of [
    [{ ...demoCustomer, email: 'another@skingoddess.test' }, demoEnv],
    [{ ...demoCustomer, role: 'admin' }, demoEnv],
    [{ ...demoCustomer, role: 'aesthetician' }, demoEnv],
    [{ ...demoCustomer, mfa_enabled: true }, demoEnv],
    [demoCustomer, { ...demoEnv, DEMO_CUSTOMER_MFA_BYPASS: 'false' }],
    [demoCustomer, { ...demoEnv, NODE_ENV: 'development' }],
  ]) {
    assert.equal(isDemoCustomer(user, env), false);
  }
});

test('the MFA bypass configuration is production-only', () => {
  assert.doesNotThrow(() => assertValidDemoCustomerConfiguration(demoEnv));
  assert.doesNotThrow(() => assertValidDemoCustomerConfiguration({
    NODE_ENV: 'production',
    DEMO_CUSTOMER_MFA_BYPASS: 'false',
  }));
  assert.throws(
    () => assertValidDemoCustomerConfiguration({
      NODE_ENV: 'development',
      DEMO_CUSTOMER_MFA_BYPASS: 'true',
    }),
    /may only be enabled in production/,
  );
});

test('customer role cannot access admin resources and staff roles remain unchanged', () => {
  assert.equal(hasRoleAccess('client', ['client']), true);
  assert.equal(hasRoleAccess('client', ['admin']), false);
  assert.equal(hasRoleAccess('admin', ['admin']), true);
  assert.equal(hasRoleAccess('admin', ['client'], true), true);
  assert.ok(STAFF_ROLES.includes('admin'));
  assert.equal(STAFF_ROLES.includes('client'), false);
  assert.equal(isDemoCustomer({
    email: 'staff@example.test',
    role: 'aesthetician',
    mfa_enabled: false,
  }, demoEnv), false);
});

test('customer appointment history uses only the authenticated customer ID', async () => {
  const authenticatedUserId = 284;
  const calls = [];
  const fakeDatabase = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ user_id: authenticatedUserId }] };
    },
  };

  const result = await loadCustomerAppointmentHistory(fakeDatabase, authenticatedUserId);
  assert.equal(result.rows[0].user_id, authenticatedUserId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [authenticatedUserId]);
  assert.match(calls[0].sql, /WHERE a\.user_id = \$1/);
  assert.match(CUSTOMER_APPOINTMENTS_QUERY, /a\.is_demo/);
  assert.match(CUSTOMER_APPOINTMENTS_QUERY, /LEFT JOIN users aesthetician/);
  assert.doesNotMatch(CUSTOMER_APPOINTMENTS_QUERY, /OR\s+a\.user_id|WHERE\s+TRUE/i);
});

test('shared demo account cannot change profile or sign-in credentials', async () => {
  const middleware = createPreserveDemoCustomerAccess({
    async query(_sql, values) {
      assert.deepEqual(values, [42]);
      return { rows: [{ ...demoCustomer, mfa_enabled: true }] };
    },
  });
  const response = createResponse();
  let nextCalled = false;

  await middleware({ session: { userId: 42 } }, response, () => {
    nextCalled = true;
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /shared survey account/);
  assert.equal(nextCalled, false);

  const ordinaryAccountMiddleware = createPreserveDemoCustomerAccess({
    async query() {
      return { rows: [{ ...demoCustomer, email: 'regular@example.test' }] };
    },
  });
  await ordinaryAccountMiddleware({ session: { userId: 42 } }, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('demo payment guard blocks only the exact survey customer', async () => {
  const middleware = createBlockDemoCustomerPayments({
    async query(_sql, values) {
      assert.deepEqual(values, [42]);
      return { rows: [demoCustomer] };
    },
  });
  const response = createResponse();
  let nextCalled = false;

  await middleware({ session: { userId: 42 } }, response, () => {
    nextCalled = true;
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /Payments are unavailable/);
  assert.equal(nextCalled, false);

  const ordinaryAccountMiddleware = createBlockDemoCustomerPayments({
    async query() {
      return { rows: [{ ...demoCustomer, email: 'regular@example.test' }] };
    },
  });
  await ordinaryAccountMiddleware({ session: { userId: 42 } }, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('PayMongo configuration remains available for regular accounts', () => {
  assert.deepEqual(getPayMongoConfig({
    ...demoEnv,
    PAYMONGO_LIVE_SECRET_KEY: 'sk_live_test',
    PAYMONGO_LIVE_WEBHOOK_SECRET: 'live-webhook',
  }), {
    mode: 'live',
    isLive: true,
    secretKey: 'sk_live_test',
    webhookSecret: 'live-webhook',
  });
});

test('demo migration is additive and is not included in the existing migration chain', () => {
  assert.equal(packageJson.scripts['migrate:demo-customer'], 'node migrations/043-demo-customer-appointments.js');
  assert.doesNotMatch(packageJson.scripts.migrate, /043-demo-customer-appointments/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'migrations', '043-demo-customer-appointments.js'), 'utf8'),
    /ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE/,
  );
});

test('demo database setup requires an exact configured PostgreSQL host and port', () => {
  const env = {
    DB_HOST: 'demo-db.example.test',
    DB_PORT: '5432',
    DEMO_CUSTOMER_TARGET_DATABASE: 'approved_demo_db',
    DEMO_CUSTOMER_TARGET_HOST: 'demo-db.example.test',
    DEMO_CUSTOMER_TARGET_PORT: '5432',
  };
  assert.deepEqual(assertDemoDatabaseTargetConfigured(env), {
    database: 'approved_demo_db',
    host: 'demo-db.example.test',
    port: 5432,
  });
  assert.throws(
    () => assertDemoDatabaseTargetConfigured({ ...env, DEMO_CUSTOMER_TARGET_HOST: '' }),
    /target is incomplete/,
  );
  assert.throws(
    () => assertDemoDatabaseTargetConfigured({ ...env, DEMO_CUSTOMER_TARGET_HOST: 'other.example.test' }),
    /target is incomplete/,
  );
  assert.throws(
    () => assertDemoDatabaseTargetConfigured({ ...env, DEMO_CUSTOMER_TARGET_PORT: '5433' }),
    /target is incomplete/,
  );
});

test('demo database verification checks the connected database identity', async () => {
  const env = {
    DB_HOST: 'demo-db.example.test',
    DB_PORT: '5432',
    DEMO_CUSTOMER_TARGET_DATABASE: 'approved_demo_db',
    DEMO_CUSTOMER_TARGET_HOST: 'demo-db.example.test',
    DEMO_CUSTOMER_TARGET_PORT: '5432',
  };
  const matchingClient = {
    async query(sql) {
      assert.match(sql, /current_database\(\)/);
      assert.doesNotMatch(sql, /inet_server_addr|inet_server_port/);
      return {
        rows: [{ database_name: 'approved_demo_db' }],
      };
    },
  };
  await assertConnectedDemoDatabaseTarget(matchingClient, env);

  const wrongDatabaseClient = {
    async query() {
      return { rows: [{ database_name: 'different_database' }] };
    },
  };
  await assert.rejects(
    assertConnectedDemoDatabaseTarget(wrongDatabaseClient, env),
    /does not match the explicitly approved demo target/,
  );
});

test('staff, public, and admin rating reads exclude synthetic appointment ratings', () => {
  const ratingsRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ratings.js'), 'utf8');
  assert.match(ratingsRoutes, /FROM appointment_ratings r\s+LEFT JOIN appointments a ON a\.appointment_id = r\.appointment_id\s+WHERE r\.staff_id = \$1 AND a\.is_demo IS DISTINCT FROM TRUE/);
  assert.match(ratingsRoutes, /WHERE r\.is_public = TRUE[\s\S]*?AND a\.is_demo IS DISTINCT FROM TRUE/);
  assert.match(ratingsRoutes, /const filters = \['a\.is_demo IS DISTINCT FROM TRUE'\]/);
  assert.match(ratingsRoutes, /LEFT JOIN appointments a ON a\.appointment_id = r\.appointment_id/);
});

test('synthetic appointments are excluded from operational and finance paths', () => {
  const appointmentsRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointments.js'), 'utf8');
  const financeRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'finance.js'), 'utf8');
  assert.match(appointmentsRoutes, /WHERE a\.is_demo = FALSE/);
  assert.match(appointmentsRoutes, /Synthetic survey appointments cannot be changed/);
  assert.match(appointmentsRoutes, /Synthetic survey appointments cannot be rated/);
  assert.match(financeRoutes, /a\.is_demo = FALSE AND a\.appointment_status = 'completed'/);
  assert.match(financeRoutes, /COALESCE\(a\.is_demo, FALSE\) = FALSE/);
  assert.match(financeRoutes, /COALESCE\(appointment\.is_demo, FALSE\) = FALSE/);
  assert.match(financeRoutes, /appointment\.appointment_id = payment\.appointment_id/);
  assert.match(financeRoutes, /Payments are disabled for synthetic survey appointments/);
  assert.match(financeRoutes, /Payment adjustments are disabled for synthetic survey appointments/);
});

test('admin rebooking rejects synthetic appointments before schedule validation or inserts', () => {
  const appointmentsRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appointments.js'), 'utf8');
  const rebookHandler = appointmentsRoutes.split("router.post('/admin/:id/rebook'")[1].split("router.get('/admin/walk-in-options'")[0];
  const demoCheck = rebookHandler.indexOf('if (original.is_demo)');
  const scheduleValidation = rebookHandler.indexOf('getValidatedSchedule');
  const appointmentInsert = rebookHandler.indexOf('INSERT INTO appointments');

  assert.notEqual(demoCheck, -1);
  assert.ok(demoCheck < scheduleValidation);
  assert.ok(demoCheck < appointmentInsert);
  assert.match(rebookHandler, /Synthetic survey appointments cannot be rebooked/);
});

test('credential files are created with verified user-only Windows ACLs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-credential-test-'));
  const credentialFile = path.join(directory, 'credentials.txt');
  const contents = `${DEMO_CUSTOMER_EMAIL}\nsynthetic-test-password\n`;

  try {
    createSecureCredentialFile(credentialFile, contents);
    assert.equal(fs.readFileSync(credentialFile, 'utf8'), contents);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(credentialFile).mode & 0o077, 0);
    }
  } finally {
    if (fs.existsSync(credentialFile)) fs.unlinkSync(credentialFile);
    fs.rmdirSync(directory);
  }
});

test('seed retries preserve credentials after an ambiguous COMMIT outcome', () => {
  const seedScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-demo-customer.js'), 'utf8');
  assert.match(seedScript, /if \(credentialFileCreated && !commitAttempted\) fs\.unlinkSync\(filePath\)/);
  assert.match(seedScript, /if \(commitAttempted\) \{\s*console\.error\('The COMMIT outcome may be unknown/);
  assert.match(seedScript, /refusing to overwrite it/);
});

test('Brevo operations for the demo account are blocked while ordinary customer email remains available', async () => {
  const environmentKeys = ['BREVO_API_KEY', 'EMAIL_USER', 'INQUIRY_NOTIFICATION_EMAIL'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  Object.assign(process.env, {
    BREVO_API_KEY: 'test-key',
    EMAIL_USER: 'sender@example.test',
    INQUIRY_NOTIFICATION_EMAIL: 'inbox@example.test',
  });
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, text: async () => '' };
  };

  try {
    const calls = [
      () => mailer.sendOtpEmail(DEMO_CUSTOMER_EMAIL, '123456'),
      () => mailer.sendPasswordResetEmail(DEMO_CUSTOMER_EMAIL, 'https://example.test/reset'),
      () => mailer.sendAppointmentReminderEmail({
        appointment_date: '2026-11-01',
        appointment_time: '10:00:00',
        first_name: 'Demo',
        service_name: 'Sample service',
        email: DEMO_CUSTOMER_EMAIL,
      }, 24),
      () => mailer.sendInquiryReply(DEMO_CUSTOMER_EMAIL, 'Demo', 'Reply'),
      () => mailer.sendInquiryNotification({
        firstName: 'Demo',
        lastName: 'Customer',
        email: DEMO_CUSTOMER_EMAIL,
        phone: '',
        subject: 'Question',
        message: 'Sample',
      }),
      () => mailer.sendNotificationEmail(DEMO_CUSTOMER_EMAIL, 'appointment_changed', 'Sample'),
    ];
    for (const call of calls) {
      await assert.rejects(call, /disabled for the survey account/);
    }
    assert.equal(fetchCalls, 0);

    await mailer.sendOtpEmail('person@example.test', '123456');
    assert.equal(fetchCalls, 1);
    assert.throws(
      () => assertDemoCustomerExternalOperationAllowed('Brevo email delivery', DEMO_CUSTOMER_EMAIL),
      /disabled for the survey account/,
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of environmentKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});
