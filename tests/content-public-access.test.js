const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const contentRouter = require('../routes/content');

const originalQuery = db.query;

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    contentType: undefined,
    sent: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(value) {
      this.sent = value;
      return this;
    },
  };
}

function routeHandler(path, method) {
  const layer = contentRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
}

test.after(() => {
  db.query = originalQuery;
});

test('public page API queries only published blocks and excludes unpublished payload metadata', async () => {
  let query;
  const contentRows = [
    {
      content_key: 'published_story',
      label: 'Our Story',
      title: 'Published title',
      body: 'Published body',
      payload: { imageUrl: '/images/public.jpg' },
      page_key: 'about',
      image_url: '/images/public.jpg',
      is_published: true,
    },
    {
      content_key: 'draft_story',
      label: 'Draft metadata',
      title: 'Secret draft title',
      body: 'Secret draft body',
      payload: { internalNote: 'Unpublished private payload' },
      page_key: 'about',
      image_url: '/api/content/images/5f3d9d2a-8211-4b67-8fcf-2ae9b468a012',
      is_published: false,
    },
  ];
  db.query = async (sql, values) => {
    query = { sql, values };
    return {
      rows: sql.includes('AND is_published = TRUE')
        ? contentRows.filter((row) => row.is_published)
        : contentRows,
    };
  };
  const response = responseCapture();

  await routeHandler('/public/pages/:pageKey', 'get')({
    params: { pageKey: 'about' },
  }, response);

  assert.equal(query.values[0], 'about');
  assert.match(query.sql, /WHERE page_key = \$1 AND is_published = TRUE/i);
  assert.doesNotMatch(query.sql, /CASE WHEN is_published/i);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].title, 'Published title');
  assert.deepEqual(response.body[0].payload, { imageUrl: '/images/public.jpg' });
  assert.equal(response.body[0].isPublished, true);
  assert.doesNotMatch(JSON.stringify(response.body), /Secret draft|Unpublished private payload|Draft metadata|5f3d9d2a/);
});

test('content image API serves only images referenced by published content or team members', async () => {
  let query;
  db.query = async (sql, values) => {
    query = { sql, values };
    return { rows: [] };
  };
  const response = responseCapture();

  await routeHandler('/images/:imageId', 'get')({
    params: { imageId: '5f3d9d2a-8211-4b67-8fcf-2ae9b468a012' },
  }, response);

  assert.match(query.sql, /content\.is_published = TRUE/i);
  assert.match(query.sql, /member\.is_published = TRUE/i);
  assert.equal(response.statusCode, 404);
});

test('published CMS images remain publicly retrievable', async () => {
  const image = Buffer.from('published image');
  let query;
  db.query = async (sql) => {
    query = sql;
    return { rows: [{ mime_type: 'image/png', image_data: image }] };
  };
  const response = responseCapture();

  await routeHandler('/images/:imageId', 'get')({
    params: { imageId: '5f3d9d2a-8211-4b67-8fcf-2ae9b468a012' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, 'image/png');
  assert.equal(response.sent, image);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.match(query, /content\.is_published = TRUE/i);
  assert.match(query, /member\.is_published = TRUE/i);
});
