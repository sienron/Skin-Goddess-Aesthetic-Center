const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../db');
const { PostgresRateLimitStore } = require('../utils/postgresRateLimitStore');

const originalQuery = db.query;

test('rate-limit counters hash client keys and use separate persistent namespaces', async () => {
  const queries = [];
  let totalHits = 0;
  db.query = async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('INSERT INTO rate_limit_counters')) {
      totalHits += 1;
      return { rows: [{ total_hits: totalHits, reset_at: new Date('2026-01-01T00:01:00Z') }] };
    }
    return { rows: [] };
  };

  try {
    const loginStore = new PostgresRateLimitStore('auth-login');
    loginStore.init({ windowMs: 60_000 });
    const first = await loginStore.increment('203.0.113.15');
    const second = await loginStore.increment('203.0.113.15');
    const chatbotStore = new PostgresRateLimitStore('chatbot');
    chatbotStore.init({ windowMs: 900_000 });
    await chatbotStore.increment('203.0.113.15');

    assert.equal(first.totalHits, 1);
    assert.equal(second.totalHits, 2);
    assert.equal(first.resetTime.toISOString(), '2026-01-01T00:01:00.000Z');
    const increments = queries.filter(({ sql }) => sql.includes('INSERT INTO rate_limit_counters'));
    assert.equal(increments.length, 3);
    assert.deepEqual(increments.map(({ values }) => values[0]), [
      'auth-login',
      'auth-login',
      'chatbot',
    ]);
    assert.deepEqual(
      increments.map(({ values }) => values[1]),
      Array(3).fill(crypto.createHash('sha256').update('203.0.113.15').digest('hex'))
    );

    await loginStore.decrement('203.0.113.15');
    await loginStore.resetKey('203.0.113.15');
    assert.match(queries.at(-2).sql, /GREATEST\(total_hits - 1, 0\)/);
    assert.match(queries.at(-1).sql, /DELETE FROM rate_limit_counters/);
  } finally {
    db.query = originalQuery;
  }
});

test('rate-limit store rejects missing or invalid windows and limiter names', async () => {
  assert.throws(() => new PostgresRateLimitStore('../bad'), /stable rate limiter name/);
  const store = new PostgresRateLimitStore('test');
  await assert.rejects(() => store.increment('client'), /no valid window/);
});

test.after(() => {
  db.query = originalQuery;
});
