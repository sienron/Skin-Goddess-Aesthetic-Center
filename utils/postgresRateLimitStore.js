const crypto = require('node:crypto');
const db = require('../db');

class PostgresRateLimitStore {
  constructor(limiterName) {
    if (typeof limiterName !== 'string' || !/^[a-z0-9_-]+$/i.test(limiterName)) {
      throw new TypeError('A stable rate limiter name is required.');
    }
    this.limiterName = limiterName;
    this.windowMs = 0;
    this.nextCleanupAt = 0;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new Error(`Rate limiter "${this.limiterName}" has no valid window.`);
    }

    const clientKey = crypto.createHash('sha256').update(String(key)).digest('hex');
    const result = await db.query(`
      INSERT INTO rate_limit_counters (limiter_key, client_key, total_hits, reset_at)
      VALUES ($1, $2, 1, NOW() + ($3 * INTERVAL '1 millisecond'))
      ON CONFLICT (limiter_key, client_key) DO UPDATE SET
        total_hits = CASE
          WHEN rate_limit_counters.reset_at <= NOW() THEN 1
          ELSE rate_limit_counters.total_hits + 1
        END,
        reset_at = CASE
          WHEN rate_limit_counters.reset_at <= NOW()
            THEN NOW() + ($3 * INTERVAL '1 millisecond')
          ELSE rate_limit_counters.reset_at
        END
      RETURNING total_hits, reset_at
    `, [this.limiterName, clientKey, this.windowMs]);

    if (Date.now() >= this.nextCleanupAt) {
      this.nextCleanupAt = Date.now() + 5 * 60 * 1000;
      try {
        await db.query(`
          WITH expired AS (
            SELECT limiter_key, client_key
            FROM rate_limit_counters
            WHERE reset_at < NOW() - INTERVAL '1 day'
            ORDER BY reset_at
            LIMIT 500
          )
          DELETE FROM rate_limit_counters AS counters
          USING expired
          WHERE counters.limiter_key = expired.limiter_key
            AND counters.client_key = expired.client_key
        `);
      } catch (error) {
        this.nextCleanupAt = Date.now() + 60 * 1000;
        console.error('Rate-limit counter cleanup failed:', error.message);
      }
    }

    return {
      totalHits: result.rows[0].total_hits,
      resetTime: new Date(result.rows[0].reset_at),
    };
  }

  async decrement(key) {
    const clientKey = crypto.createHash('sha256').update(String(key)).digest('hex');
    await db.query(`
      UPDATE rate_limit_counters
      SET total_hits = GREATEST(total_hits - 1, 0)
      WHERE limiter_key = $1 AND client_key = $2
    `, [this.limiterName, clientKey]);
  }

  async resetKey(key) {
    const clientKey = crypto.createHash('sha256').update(String(key)).digest('hex');
    await db.query(
      'DELETE FROM rate_limit_counters WHERE limiter_key = $1 AND client_key = $2',
      [this.limiterName, clientKey]
    );
  }
}

module.exports = { PostgresRateLimitStore };
