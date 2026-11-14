const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');
const mailer = require('../utils/mailer');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const originalSendPasswordResetEmail = mailer.sendPasswordResetEmail;
const originalAppBaseUrl = process.env.APP_BASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const sentEmails = [];
let failDelivery = false;

process.env.APP_BASE_URL = 'http://localhost:3000';
mailer.sendPasswordResetEmail = async (email, link) => {
  if (failDelivery) throw new Error('Brevo rejected the message');
  sentEmails.push({ email, link });
};

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
    clearCookie() {
      return this;
    },
  };
}

function registeredClient() {
  return {
    user_id: 21,
    email: 'client@example.com',
    role: 'client',
  };
}

test('forgot-password waits for successful delivery before confirming the request', async () => {
  sentEmails.length = 0;
  const statements = [];
  db.query = async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('FROM users WHERE LOWER(email)')) return { rows: [registeredClient()] };
    if (sql.includes('SELECT COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
    return { rows: [] };
  };
  const response = responseCapture();

  await routeHandler('/forgot-password', 'post')({
    body: { email: 'client@example.com' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /If an account exists/);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].email, 'client@example.com');
  assert.match(sentEmails[0].link, /^http:\/\/localhost:3000\/ResetPassword\.html\?token=[a-f0-9]{64}$/);
  assert.match(statements[2].sql, /INSERT INTO password_reset_tokens/);
  assert.equal(statements[2].values[1].length, 64);
  assert.notEqual(statements[2].values[1], new URL(sentEmails[0].link).searchParams.get('token'));
});

test('forgot-password hides delivery failures with the same generic response', async () => {
  const statements = [];
  db.query = async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('FROM users WHERE LOWER(email)')) return { rows: [registeredClient()] };
    if (sql.includes('SELECT COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
    return { rows: [] };
  };
  failDelivery = true;
  const response = responseCapture();

  try {
    await routeHandler('/forgot-password', 'post')({
      body: { email: 'client@example.com' },
    }, response);
  } finally {
    failDelivery = false;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    message: 'If an account exists for this email, reset instructions will be sent.',
  });
  assert.equal(statements.some(({ sql }) => sql.includes('DELETE FROM password_reset_tokens')), true);
});

test('forgot-password keeps the response generic when the address has no account', async () => {
  sentEmails.length = 0;
  db.query = async () => ({ rows: [] });
  const response = responseCapture();

  await routeHandler('/forgot-password', 'post')({
    body: { email: 'unknown@example.com' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body.message, /If an account exists/);
  assert.equal(sentEmails.length, 0);
});

test('password reset invalidates other reset tokens and trusted devices', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const currentPasswordHash = await bcrypt.hash('OldPassword1!', 12);
  const statements = [];
  db.query = async (sql) => {
    if (sql.includes('FROM password_reset_tokens') && sql.includes('SELECT reset_id, user_id')) {
      return { rows: [{ reset_id: 8, user_id: 21 }] };
    }
    if (sql.includes('FROM users WHERE user_id = $1')) {
      return {
        rows: [{
          password_hash: currentPasswordHash,
          email: 'client@example.com',
          role: 'client',
          mfa_enabled: false,
          status: 'active',
          email_verified: true,
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      statements.push({ sql, values });
      return { rows: sql.includes('RETURNING reset_id') ? [{ reset_id: 8 }] : [] };
    },
  });
  const response = responseCapture();

  try {
    await routeHandler('/reset-password', 'post')({
      body: { token, newPassword: 'NewPassword2!' },
      session: { destroy(callback) { callback(null); } },
    }, response);
  } finally {
    db.transaction = originalTransaction;
  }

  assert.equal(response.statusCode, 200);
  assert.ok(statements.some(({ sql }) => /UPDATE password_reset_tokens SET is_used = TRUE WHERE user_id = \$1 AND is_used = FALSE/.test(sql)));
  assert.ok(statements.some(({ sql }) => sql.includes('DELETE FROM trusted_login_devices WHERE user_id = $1')));
});

test.after(() => {
  db.query = originalQuery;
  db.transaction = originalTransaction;
  mailer.sendPasswordResetEmail = originalSendPasswordResetEmail;
  if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalAppBaseUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});
