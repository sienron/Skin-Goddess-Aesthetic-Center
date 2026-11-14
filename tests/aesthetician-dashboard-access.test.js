const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const appointmentsRouter = require('../routes/appointments');
const ratingsRouter = require('../routes/ratings');

const originalQuery = db.query;

function routeFor(router, path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.map((middleware) => middleware.handle);
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

async function authorize(roleGate, userId, role) {
  db.query = async (sql) => {
    assert.match(sql, /SELECT role, status, dev_access_all/);
    return {
      rows: [{
        role,
        status: 'active',
        dev_access_all: false,
        totp_enabled: false,
        totp_enrolled_at: null,
      }],
    };
  };
  const request = {
    session: { userId },
    path: '/api/resource',
    originalUrl: '/api/resource',
    accepts: () => 'json',
  };
  const response = responseCapture();
  let allowed = false;
  await roleGate(request, response, () => { allowed = true; });
  return { allowed, request, response };
}

test('aesthetician treatment history is filtered by the session user, not request filters', async () => {
  const [roleGate, handler] = routeFor(
    appointmentsRouter,
    '/treatment-history/mine',
    'get',
  );
  const denied = await authorize(roleGate, 7, 'client');
  assert.equal(denied.allowed, false);
  assert.equal(denied.response.statusCode, 403);

  const userId = 31;
  const { allowed, request } = await authorize(roleGate, userId, 'aesthetician');
  assert.equal(allowed, true);

  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    return {
      rows: [{
        appointment_id: 104,
        client: 'Customer',
        service: 'Facial',
        date: '2026-10-01',
        status: 'completed',
      }],
    };
  };
  request.query = { aestheticianId: '44', appointmentId: '105' };
  const response = responseCapture();
  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body[0].id, 104);
  assert.match(queries[0].sql, /WHERE a\.aesthetician_id = \$1/);
  assert.deepEqual(queries[0].values, [userId]);
});

test('aesthetician review endpoint denies clients and only queries completed own appointments', async () => {
  const [roleGate, handler] = routeFor(ratingsRouter, '/mine/reviews', 'get');
  const denied = await authorize(roleGate, 7, 'client');
  assert.equal(denied.allowed, false);
  assert.equal(denied.response.statusCode, 403);

  const userId = 31;
  const authorized = await authorize(roleGate, userId, 'aesthetician');
  assert.equal(authorized.allowed, true);
  const queries = [];
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    if (/COUNT\(\*\) AS total/.test(sql)) {
      return { rows: [{ total: 1, average: 5, s5: 1, s4: 0, s3: 0, s2: 0, s1: 0 }] };
    }
    return {
      rows: [{
        rating_id: 8,
        rating: 5,
        comment: 'Wonderful treatment.',
        is_automatic: false,
        created_at: '2026-10-02T10:00:00.000Z',
        appointment_date: '2026-10-01',
        service_name: 'Facial',
        client_first_name: 'Alex',
        client_last_initial: 'R',
      }],
    };
  };

  const response = responseCapture();
  await handler(authorized.request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalReviews, 1);
  assert.equal(response.body.reviews[0].client, 'Alex R.');
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /a\.aesthetician_id = r\.staff_id/);
    assert.match(query.sql, /a\.appointment_status = 'completed'/);
    assert.match(query.sql, /r\.staff_id = \$1/);
    assert.deepEqual(query.values, [userId]);
  }
});

test.after(() => {
  db.query = originalQuery;
});
