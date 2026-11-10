const db = require('../db');

async function migrate() {
  await db.query('ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash VARCHAR(64)');
  await db.query(`
    UPDATE otp_codes
    SET code_hash = COALESCE(code_hash, repeat('0', 64)), is_used = TRUE
  `);
  await db.query('ALTER TABLE otp_codes ALTER COLUMN code_hash SET NOT NULL');
  await db.query('ALTER TABLE otp_codes DROP COLUMN IF EXISTS code');

  await db.query('ALTER TABLE pending_email_changes ADD COLUMN IF NOT EXISTS code_hash VARCHAR(64)');
  await db.query(`
    UPDATE pending_email_changes
    SET code_hash = COALESCE(code_hash, repeat('0', 64)), is_used = TRUE
  `);
  await db.query('ALTER TABLE pending_email_changes ALTER COLUMN code_hash SET NOT NULL');
  await db.query('ALTER TABLE pending_email_changes DROP COLUMN IF EXISTS code');
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Email OTP hashes are ready. Existing codes were invalidated.'))
    .catch((error) => {
      console.error('Email OTP hash migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
