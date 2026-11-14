const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const { enforceSessionLifetime } = require('../middleware/sessionLifetime');
const {
  CLIENT_IDLE_TIMEOUT_MS,
  STAFF_IDLE_TIMEOUT_MS,
} = require('../utils/sessionSecurity');

const DAY = 24 * 60 * 60 * 1000;

function responseCapture() {
  return {
    statusCode: 200,
    clearedCookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(url) { this.redirectUrl = url; return this; },
    clearCookie(name) { this.clearedCookies.push(name); return this; },
  };
}

function requestFor(values = {}) {
  return {
    path: '/api/auth/me',
    originalUrl: '/api/auth/me',
    accepts: () => false,
    session: {
      userId: 17,
      staySignedIn: true,
      cookie: {},
      destroy(callback) { this.destroyed = true; callback(null); },
      ...values,
    },
  };
}

test('all roles retain their absolute 30-day cap when active, with role-specific cookie idle windows', async (t) => {
  const signedInAt = Date.now();
  let now = signedInAt;
  t.mock.method(Date, 'now', () => now);

  for (const role of ['client', 'admin', 'finance_officer', 'aesthetician', 'inventory_officer', 'staff']) {
    const deadline = signedInAt + 30 * DAY;
    const req = requestFor({ role, sessionExpiresAt: deadline });
    for (const elapsed of [0, 12 * 60 * 60 * 1000, 29 * DAY, 30 * DAY - 1]) {
      now = signedInAt + elapsed;
      req.session.lastActivityAt = now - 1;
      let allowed = false;
      await enforceSessionLifetime(req, responseCapture(), () => { allowed = true; });
      assert.equal(allowed, true, role);
      assert.equal(req.session.sessionExpiresAt, deadline);
      assert.equal(req.session.cookie.maxAge, Math.min(
        deadline - now,
        role === 'client' ? CLIENT_IDLE_TIMEOUT_MS : STAFF_IDLE_TIMEOUT_MS
      ));
    }

    now = deadline;
    req.session.lastActivityAt = now - 1;
    const res = responseCapture();
    let allowed = false;
    await enforceSessionLifetime(req, res, () => { allowed = true; });
    assert.equal(allowed, false, role);
    assert.equal(res.statusCode, 401);
    assert.equal(req.session.destroyed, true);
    assert.deepEqual(res.clearedCookies, ['connect.sid']);
  }
});

test('legacy 400-day cookies receive a fixed 30-day cap that later requests cannot reset', async (t) => {
  const startedAt = Date.now();
  let now = startedAt;
  t.mock.method(Date, 'now', () => now);
  const req = requestFor({ cookie: { expires: new Date(startedAt + 400 * DAY) } });
  await enforceSessionLifetime(req, responseCapture(), () => {});
  assert.equal(req.session.sessionExpiresAt, startedAt + 30 * DAY);

  now += 20 * DAY;
  req.session.lastActivityAt = now - 1;
  await enforceSessionLifetime(req, responseCapture(), () => {});
  assert.equal(req.session.sessionExpiresAt, startedAt + 30 * DAY);
  assert.equal(req.session.cookie.maxAge, CLIENT_IDLE_TIMEOUT_MS);
});

test('legacy sessions with an earlier cookie expiry keep the earlier deadline', async (t) => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const req = requestFor({ cookie: { expires: new Date(now + DAY) } });
  await enforceSessionLifetime(req, responseCapture(), () => {});
  assert.equal(req.session.sessionExpiresAt, now + DAY);
  assert.equal(req.session.cookie.maxAge, CLIENT_IDLE_TIMEOUT_MS);
});

test('unchecked sign-ins retain their 24-hour absolute cap and use role-specific idle windows', async (t) => {
  const signedInAt = Date.now();
  let now = signedInAt;
  t.mock.method(Date, 'now', () => now);
  for (const role of ['client', 'admin', 'finance_officer', 'staff']) {
    now = signedInAt;
    const req = requestFor({ role, staySignedIn: undefined });
    let allowed = false;
    await enforceSessionLifetime(req, responseCapture(), () => { allowed = true; });
    assert.equal(allowed, true);
    assert.equal(req.session.cookie.maxAge, role === 'client' ? CLIENT_IDLE_TIMEOUT_MS : STAFF_IDLE_TIMEOUT_MS);
    assert.equal(req.session.sessionExpiresAt, signedInAt + DAY);

    now += DAY;
    const res = responseCapture();
    await enforceSessionLifetime(req, res, () => assert.fail('Expired session reached its route'));
    assert.equal(res.statusCode, 401);
    assert.equal(req.session.destroyed, true);
  }
});

test('inactive client and staff sessions expire at their idle deadlines', async (t) => {
  const startedAt = Date.now();
  let now = startedAt;
  t.mock.method(Date, 'now', () => now);
  for (const [role, timeout] of [
    ['client', CLIENT_IDLE_TIMEOUT_MS],
    ['aesthetician', STAFF_IDLE_TIMEOUT_MS],
  ]) {
    const req = requestFor({
      role,
      sessionExpiresAt: startedAt + DAY,
      lastActivityAt: startedAt,
    });
    now = startedAt + timeout - 1;
    let allowed = false;
    await enforceSessionLifetime(req, responseCapture(), () => { allowed = true; });
    assert.equal(allowed, true, role);
    assert.equal(req.session.cookie.maxAge, Math.min(
      startedAt + DAY - now,
      timeout
    ));

    req.session.lastActivityAt = startedAt;
    now += 1;
    const response = responseCapture();
    await enforceSessionLifetime(req, response, () => assert.fail('Idle session reached its route'));
    assert.equal(response.statusCode, 401, role);
    assert.equal(req.session.destroyed, true, role);
  }
});

test('MFA pending sessions keep their short verification lifetime', async () => {
  const req = requestFor({ userId: undefined, pendingPrivilegedMfaUserId: 17, cookie: { maxAge: 600_000 } });
  let allowed = false;
  await enforceSessionLifetime(req, responseCapture(), () => { allowed = true; });
  assert.equal(allowed, true);
  assert.equal(req.session.cookie.maxAge, 600_000);
  assert.equal(req.session.sessionExpiresAt, undefined);
});

test('invalid deadlines revoke the session and expired page requests return to sign-in', async () => {
  const req = requestFor({ sessionExpiresAt: 'invalid' });
  const res = responseCapture();
  await enforceSessionLifetime(req, res, () => assert.fail('Invalid session reached its route'));
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.destroyed, true);

  const pageRequest = requestFor({ sessionExpiresAt: Date.now() - 1 });
  pageRequest.path = pageRequest.originalUrl = '/AdminDashboard.html';
  pageRequest.accepts = () => true;
  const pageResponse = responseCapture();
  await enforceSessionLifetime(pageRequest, pageResponse, () => assert.fail('Expired page was served'));
  assert.equal(pageResponse.redirectUrl, '/LoginPage.html');
});

test('real session cookies and stored sessions retain the fixed deadline and reject expired sessions', async (t) => {
  const app = express();
  const store = new session.MemoryStore();
  app.use(session({
    store,
    secret: 'session-lifetime-integration-test-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: DAY, httpOnly: true, sameSite: 'lax' },
  }));
  app.use(enforceSessionLifetime);
  let sessionId;
  app.post('/sign-in', (req, res) => {
    req.session.userId = 17;
    req.session.role = 'client';
    req.session.staySignedIn = true;
    req.session.sessionExpiresAt = Date.now() + 30 * DAY;
    req.session.cookie.maxAge = 30 * DAY;
    sessionId = req.sessionID;
    res.json({ expiresAt: req.session.sessionExpiresAt });
  });
  app.get('/api/private', (req, res) => res.json({ expiresAt: req.session.sessionExpiresAt }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', cookie) => new Promise((resolve, reject) => {
    const outgoing = http.request(`${baseUrl}${path}`, {
      method,
      agent: false,
      headers: cookie ? { cookie } : {},
    }, (incoming) => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({
        status: incoming.statusCode,
        headers: incoming.headers,
        body: JSON.parse(body),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  const login = await request('/sign-in', 'POST');
  const { expiresAt } = login.body;
  const setCookie = login.headers['set-cookie'][0];
  const cookie = setCookie.split(';')[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookieExpiry = new Date(setCookie.match(/Expires=([^;]+)/)[1]).getTime();
  assert.ok(Math.abs(cookieExpiry - expiresAt) < 1000);

  const visit = await request('/api/private', 'GET', cookie);
  assert.equal(visit.status, 200);
  assert.equal(visit.body.expiresAt, expiresAt);
  const saved = await new Promise((resolve, reject) => store.get(sessionId, (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(saved.sessionExpiresAt, expiresAt);
  saved.sessionExpiresAt = Date.now() - 1;
  await new Promise((resolve, reject) => store.set(sessionId, saved, (error) => error ? reject(error) : resolve()));

  const expired = await request('/api/private', 'GET', cookie);
  assert.equal(expired.status, 401);
  assert.match(expired.headers['set-cookie'][0], /connect\.sid=;/);
  const removed = await new Promise((resolve, reject) => store.get(sessionId, (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(removed, undefined);
});
