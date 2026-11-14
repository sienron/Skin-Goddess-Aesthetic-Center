const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const ratingsRouter = require('../routes/ratings');
const manualTestimonialsMigration = require('../migrations/053-manual-testimonials');

const originalQuery = db.query;

function routeHandler(routePath, method) {
  const layer = ratingsRouter.stack.find(
    (item) => item.route?.path === routePath && item.route.methods[method],
  );
  assert.ok(layer, `Expected ${method.toUpperCase()} ${routePath} route`);
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
  };
}

function validTestimonial(overrides = {}) {
  return {
    reviewerName: 'Jamie Reviewer',
    comment: 'Friendly staff and effective service.',
    rating: null,
    ...overrides,
  };
}

test('public testimonials combine website and Facebook reviews with masked Facebook names', async () => {
  let query;
  db.query = async (sql) => {
    query = sql;
    return {
      rows: [
        {
          rating: 1,
          comment: 'Facebook review',
          created_at: null,
          service: null,
          client: 'Irene Rabino',
          source: 'Facebook',
        },
        {
          rating: 5,
          comment: 'Website review',
          created_at: '2026-10-12T00:00:00.000Z',
          service: 'Facial',
          client: 'Website Client',
          source: 'Website',
        },
        {
          rating: null,
          comment: 'Short name review',
          created_at: null,
          service: null,
          client: 'Bo Li',
          source: 'Facebook',
        },
        ...Array.from({ length: 7 }, (_, index) => ({
          rating: 5,
          comment: `Additional review ${index + 1}`,
          service: null,
          client: 'Another Reviewer',
          source: 'Facebook',
        })),
      ],
    };
  };

  try {
    const response = responseCapture();
    await routeHandler('/public', 'get')({}, response);

    assert.match(query, /UNION ALL/);
    assert.match(query, /FROM manual_testimonials r\s+WHERE r\.is_public = TRUE/);
    assert.match(query, /ORDER BY sort_date DESC\s+LIMIT 10/);
    assert.match(query, /a\.is_demo IS DISTINCT FROM TRUE/);
    assert.equal(response.body[0].source, 'Facebook');
    assert.equal(response.body[0].client, 'Ir*** ****no');
    assert.equal(response.body[0].rating, 1);
    assert.equal('createdAt' in response.body[0], false);
    assert.equal(response.body[1].source, 'Website');
    assert.equal('createdAt' in response.body[1], false);
    assert.equal(response.body[2].client, 'B* *i');
    assert.equal('createdAt' in response.body[2], false);
    assert.equal(response.body.length, 10);
  } finally {
    db.query = originalQuery;
  }
});

test('admin can manually add a Facebook testimonial without inventing a rating', async () => {
  let values;
  db.query = async (sql, queryValues) => {
    assert.match(sql, /INSERT INTO manual_testimonials/);
    assert.match(sql, /reviewer_name, comment, rating, is_public/);
    assert.match(sql, /VALUES \(\$1, \$2, \$3, TRUE\)/);
    values = queryValues;
    return { rows: [{ manual_testimonial_id: 24 }] };
  };

  try {
    const response = responseCapture();
    await routeHandler('/manual', 'post')({ body: validTestimonial() }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.manualTestimonialId, 24);
    assert.deepEqual(values, [
      'Jamie Reviewer',
      'Friendly staff and effective service.',
      null,
    ]);
  } finally {
    db.query = originalQuery;
  }
});

test('manual testimonial rejects invalid optional ratings', async () => {
  db.query = async () => {
    throw new Error('Invalid testimonials must not reach the database.');
  };

  try {
    const handler = routeHandler('/manual', 'post');
    const invalidRating = responseCapture();
    await handler({ body: validTestimonial({ rating: 6 }) }, invalidRating);
    assert.equal(invalidRating.statusCode, 400);
    assert.match(invalidRating.body.message, /Rating must be a whole number/);
  } finally {
    db.query = originalQuery;
  }
});

test('admin can publish or unpublish manual Facebook testimonials', async () => {
  const visibilityRoute = ratingsRouter.stack.find(
    (item) => item.route?.path === '/manual/:id/public' && item.route.methods.patch,
  );
  assert.ok(visibilityRoute);

  const values = [];
  db.query = async (sql, queryValues) => {
    assert.match(sql, /UPDATE manual_testimonials SET is_public/);
    values.push(queryValues);
    return { rows: [{ manual_testimonial_id: 24 }] };
  };

  try {
    const handler = routeHandler('/manual/:id/public', 'patch');
    for (const isPublic of [false, true]) {
      const response = responseCapture();
      await handler({ params: { id: '24' }, body: { isPublic } }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.message, isPublic ? 'Testimonial published.' : 'Testimonial unpublished.');
    }
    assert.deepEqual(values, [[false, 24], [true, 24]]);
  } finally {
    db.query = originalQuery;
  }
});

test('manual testimonial migration adds publication state for existing tables', async () => {
  const statements = [];
  db.query = async (sql) => {
    statements.push(sql);
    return { rows: [] };
  };

  try {
    await manualTestimonialsMigration.migrate();
    assert.match(statements[1], /ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE/);
    assert.match(statements[3], /ON manual_testimonials \(is_public, review_date DESC, created_at DESC\)/);
  } finally {
    db.query = originalQuery;
  }
});

test('admin can delete a Facebook testimonial', async () => {
  let values;
  db.query = async (sql, queryValues) => {
    assert.match(sql, /DELETE FROM manual_testimonials/);
    values = queryValues;
    return { rows: [{ manual_testimonial_id: 24 }] };
  };

  try {
    const response = responseCapture();
    await routeHandler('/manual/:id', 'delete')({ params: { id: '24' } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(values, [24]);
  } finally {
    db.query = originalQuery;
  }
});

test.after(() => {
  db.query = originalQuery;
});
