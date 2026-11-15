const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');

const staffRoutes = [
  ['/:id/notes', 'get'],
  ['/client/:clientId/notes', 'get'],
  ['/:id/notes', 'post'],
  ['/:id/notes/:noteId', 'patch'],
  ['/:id/notes/:noteId', 'delete'],
  ['/:id/start', 'post'],
  ['/:id/no-show', 'post']
];

function routeGuard(routePath, method) {
  const route = appointmentsRouter.stack.find(
    (layer) => layer.route?.path === routePath && layer.route.methods[method]
  );
  assert.ok(route, `Expected ${method.toUpperCase()} ${routePath} route`);
  return route.route.stack[0].handle;
}

async function checkRole(guard, role) {
  const originalQuery = db.query;
  const enrolledAt = new Date();
  const session = {
    userId: 7,
    mfaVerifiedAt: enrolledAt.getTime(),
    privilegedMfaAuthenticatedAt: Date.now()
  };
  let statusCode = 200;
  let continued = false;
  db.query = async () => ({
    rows: [{
      role,
      status: 'active',
      dev_access_all: false,
      totp_enabled: true,
      totp_enrolled_at: enrolledAt.toISOString()
    }]
  });

  try {
    await guard(
      { session, accepts: () => false, originalUrl: '/api/appointments' },
      {
        status(code) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        }
      },
      () => {
        continued = true;
      }
    );
  } finally {
    db.query = originalQuery;
  }

  return { statusCode, continued };
}

test('assigned appointment note and action routes reject active users without a staff role', async () => {
  for (const [routePath, method] of staffRoutes) {
    const result = await checkRole(routeGuard(routePath, method), 'client');
    assert.equal(result.statusCode, 403, `${method.toUpperCase()} ${routePath}`);
    assert.equal(result.continued, false, `${method.toUpperCase()} ${routePath}`);
  }
});

test('assigned appointment note and action routes continue to allow aesthetician and staff roles', async () => {
  for (const [routePath, method] of staffRoutes) {
    const guard = routeGuard(routePath, method);
    for (const role of ['aesthetician', 'staff']) {
      const result = await checkRole(guard, role);
      assert.equal(result.continued, true, `${role}: ${method.toUpperCase()} ${routePath}`);
    }
  }
});
