const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const announcementsRouter = require('../routes/announcements');
const announcementReadMigration = require('../migrations/046-announcement-reads');

const originalQuery = db.query;
const originalTransaction = db.transaction;
const publicRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/public' && layer.route.methods.get)
  .route;
const updateRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id' && layer.route.methods.put)
  .route;
const createRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/admin' && layer.route.methods.post)
  .route;
const adminListRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/admin' && layer.route.methods.get)
  .route;
const publicationRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/admin/:id' && layer.route.methods.patch)
  .route;
const markReadRoute = announcementsRouter.stack
  .find((layer) => layer.route?.path === '/:id/read' && layer.route.methods.patch)
  .route;

test.after(async () => {
  await db.pool.end();
});

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

async function requestPublicAnnouncements({ role, devAccessAll = false }) {
  let announcementQueryCount = 0;
  db.query = async (sql) => {
    if (sql.includes('SELECT role, status, dev_access_all')) {
      return { rows: [{ role, status: 'active', dev_access_all: devAccessAll }] };
    }
    announcementQueryCount += 1;
    return { rows: [] };
  };

  const req = {
    session: { userId: 1 },
    accepts: () => false,
    originalUrl: '/api/announcements/public',
    path: '/public',
  };
  const res = responseCapture();
  const handlers = publicRoute.stack.map((layer) => layer.handle);

  try {
    await new Promise((resolve, reject) => {
      let index = 0;
      function next(error) {
        if (error) {
          reject(error);
          return;
        }
        const handler = handlers[index++];
        if (!handler) return resolve();
        Promise.resolve(handler(req, res, next))
          .then(() => {
            if (index === handlers.length || res.body !== undefined) resolve();
          })
          .catch(reject);
      }
      next();
    });
    return { response: res, announcementQueryCount };
  } finally {
    db.query = originalQuery;
  }
}

test('only client accounts can load public promotional announcements', async () => {
  const { response, announcementQueryCount } = await requestPublicAnnouncements({ role: 'client' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { announcements: [] });
  assert.equal(announcementQueryCount, 1);
});

test('staff accounts cannot load promotional announcements, including local dev-access accounts', async () => {
  const { response, announcementQueryCount } = await requestPublicAnnouncements({
    role: 'admin',
    devAccessAll: true,
  });

  assert.equal(response.statusCode, 403);
  assert.equal(announcementQueryCount, 0);
});

test('editing a promotional announcement saves its updated start and end dates', async () => {
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const queryCalls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, values) => {
      queryCalls.push({ sql, values });
      if (sql.includes('UPDATE promotional_announcements')) {
        return {
          rows: [{
            announcement_id: 1,
            type: 'promo',
            title: 'Updated promo',
            message: 'Updated details',
            image_url: '',
            starts_at: new Date(startsAt),
            ends_at: new Date(endsAt),
            is_published: true,
          }],
        };
      }
      return { rows: [] };
    },
  });
  db.query = async () => {
    throw new Error('Editing should use a transaction.');
  };

  const res = responseCapture();
  const updateHandler = updateRoute.stack.at(-1).handle;
  try {
    await updateHandler({
      params: { id: '1' },
      body: {
        type: 'promo',
        title: 'Updated promo',
        message: 'Updated details',
        imageUrl: '',
        startsAt,
        endsAt,
        isPublished: true,
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.starts_at.toISOString(), startsAt);
    assert.equal(res.body.ends_at.toISOString(), endsAt);
    assert.equal(queryCalls[0].values[4].toISOString(), startsAt);
    assert.equal(queryCalls[0].values[5].toISOString(), endsAt);
    assert.match(queryCalls[1].sql, /DELETE FROM promotional_announcement_reads/);
    assert.deepEqual(queryCalls[1].values, [1]);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('creating a promotional announcement requires both start and end dates', async () => {
  let queryCalled = false;
  db.query = async () => {
    queryCalled = true;
    return { rows: [] };
  };

  const res = responseCapture();
  const createHandler = createRoute.stack.at(-1).handle;
  try {
    await createHandler({
      body: {
        type: 'promo',
        title: 'Promo without dates',
        message: 'Dates should be required.',
        imageUrl: '',
        startsAt: null,
        endsAt: null,
        isPublished: true,
      },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /start date and time/);
    assert.equal(queryCalled, false);
  } finally {
    db.query = originalQuery;
  }
});

test('creating a promotional announcement rejects start or end dates in the past', async () => {
  let queryCalled = false;
  db.query = async () => {
    queryCalled = true;
    return { rows: [] };
  };

  const createHandler = createRoute.stack.at(-1).handle;
  const validInput = {
    type: 'promo',
    title: 'Promo with past dates',
    message: 'Dates should be in the future.',
    imageUrl: '',
    startsAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    endsAt: new Date(Date.now() - 60_000).toISOString(),
    isPublished: true,
  };
  const res = responseCapture();

  try {
    await createHandler({ body: validInput }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /selected start time has already passed/);
    assert.equal(queryCalled, false);
  } finally {
    db.query = originalQuery;
  }
});

test('admin list marks ended announcements unpublished and identifies them as expired', async () => {
  const endedAt = new Date(Date.now() - 60_000);
  db.query = async (sql) => {
    assert.match(sql, /ends_at <= NOW\(\).*AS is_expired/s);
    return {
      rows: [{
        announcement_id: 3,
        type: 'promo',
        title: 'Ended promo',
        message: 'Expired',
        starts_at: new Date(Date.now() - 3_600_000),
        ends_at: endedAt,
        is_published: false,
        is_expired: true,
      }],
    };
  };

  const res = responseCapture();
  try {
    await adminListRoute.stack.at(-1).handle({}, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body[0].is_published, false);
    assert.equal(res.body[0].is_expired, true);
    assert.equal(res.body[0].ends_at, endedAt);
  } finally {
    db.query = originalQuery;
  }
});

test('expired announcements cannot be republished until their dates are updated', async () => {
  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    return queryCount === 1
      ? { rows: [] }
      : { rows: [{ announcement_id: 3 }] };
  };

  const res = responseCapture();
  try {
    await publicationRoute.stack.at(-1).handle({
      params: { id: '3' },
      body: { isPublished: true },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /future times before publishing/);
    assert.equal(queryCount, 2);
  } finally {
    db.query = originalQuery;
  }
});

test('marking a promotional announcement read saves it to the current customer account', async () => {
  let queryCall;
  db.query = async (sql, values) => {
    queryCall = { sql, values };
    return { rows: [{ announcement_id: 8 }] };
  };

  const res = responseCapture();
  const markReadHandler = markReadRoute.stack.at(-1).handle;
  try {
    await markReadHandler({ params: { id: '8' }, session: { userId: 42 } }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /marked as read/);
    assert.match(queryCall.sql, /INSERT INTO promotional_announcement_reads/);
    assert.deepEqual(queryCall.values, [42, 8]);
  } finally {
    db.query = originalQuery;
  }
});

test('announcement read migration creates per-user read state', async () => {
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };

  try {
    await announcementReadMigration.migrate();
    assert.equal(statements.length, 1);
    assert.match(statements[0], /CREATE TABLE IF NOT EXISTS promotional_announcement_reads/);
    assert.match(statements[0], /PRIMARY KEY \(user_id, announcement_id\)/);
    assert.match(statements[0], /read_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  } finally {
    db.query = originalQuery;
  }
});
