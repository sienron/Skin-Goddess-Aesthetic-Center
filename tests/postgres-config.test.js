const test = require('node:test');
const assert = require('node:assert/strict');
const { getPostgresSslConfig } = require('../utils/postgresConfig');

test('production PostgreSQL connections always verify TLS certificates', () => {
  assert.deepEqual(
    getPostgresSslConfig({ NODE_ENV: 'production', DB_SSL: 'false' }),
    { rejectUnauthorized: true },
  );
  assert.deepEqual(
    getPostgresSslConfig({ NODE_ENV: 'production' }),
    { rejectUnauthorized: true },
  );
});

test('local PostgreSQL connections preserve the no-TLS development default', () => {
  assert.equal(getPostgresSslConfig({ NODE_ENV: 'development', DB_SSL: 'false' }), false);
  assert.equal(getPostgresSslConfig({ NODE_ENV: 'development' }), false);
});

test('opt-in TLS for non-production connections still verifies certificates', () => {
  assert.deepEqual(
    getPostgresSslConfig({ NODE_ENV: 'development', DB_SSL: 'true' }),
    { rejectUnauthorized: true },
  );
});
