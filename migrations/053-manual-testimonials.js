const db = require('../db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS manual_testimonials (
      manual_testimonial_id SERIAL PRIMARY KEY,
      reviewer_name VARCHAR(120) NOT NULL CHECK (char_length(BTRIM(reviewer_name)) BETWEEN 1 AND 120),
      comment TEXT NOT NULL CHECK (char_length(BTRIM(comment)) BETWEEN 1 AND 2000),
      rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
      source_url TEXT CHECK (char_length(source_url) <= 2048),
      review_date DATE,
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    ALTER TABLE manual_testimonials
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS manual_testimonials_date_idx
    ON manual_testimonials (review_date DESC, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS manual_testimonials_public_date_idx
    ON manual_testimonials (is_public, review_date DESC, created_at DESC)
  `);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Manual testimonials migration completed.'))
    .catch((error) => {
      console.error('Manual testimonials migration failed.', error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
