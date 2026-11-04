const db = require('../db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS promotional_announcement_reads (
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      announcement_id BIGINT NOT NULL REFERENCES promotional_announcements(announcement_id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, announcement_id)
    )
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Promotional announcement read-state migration completed successfully.'))
    .catch((error) => {
      console.error('Promotional announcement read-state migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
