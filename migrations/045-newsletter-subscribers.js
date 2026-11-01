const db = require('../db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      subscriber_id SERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_lower_unique
      ON newsletter_subscribers (LOWER(email))
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Newsletter subscribers migration completed successfully.'))
    .catch((error) => {
      console.error('Newsletter subscribers migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
