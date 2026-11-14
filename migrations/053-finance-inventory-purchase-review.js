const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    await client.query(`
      ALTER TABLE inventory_purchase_records
        ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

      UPDATE inventory_purchase_records
      SET review_status = CASE
        WHEN expense_id IS NOT NULL THEN 'approved'
        ELSE 'pending'
      END
      WHERE review_status = 'pending' AND expense_id IS NOT NULL;

      ALTER TABLE inventory_purchase_records
        DROP CONSTRAINT IF EXISTS inventory_purchase_records_review_status_check,
        ADD CONSTRAINT inventory_purchase_records_review_status_check
          CHECK (review_status IN ('pending', 'approved', 'rejected')),
        DROP CONSTRAINT IF EXISTS inventory_purchase_records_review_link_check,
        ADD CONSTRAINT inventory_purchase_records_review_link_check
          CHECK (
            (review_status = 'approved' AND expense_id IS NOT NULL)
            OR (review_status IN ('pending', 'rejected') AND expense_id IS NULL)
          ),
        DROP CONSTRAINT IF EXISTS inventory_purchase_records_rejection_audit_check,
        ADD CONSTRAINT inventory_purchase_records_rejection_audit_check
          CHECK (
            (review_status = 'rejected'
              AND rejected_at IS NOT NULL
              AND rejection_reason IS NOT NULL
              AND LENGTH(BTRIM(rejection_reason)) > 0)
            OR (review_status <> 'rejected'
              AND rejected_at IS NULL
              AND rejection_reason IS NULL)
          );

      CREATE INDEX IF NOT EXISTS inventory_purchase_pending_review_idx
        ON inventory_purchase_records (purchase_date, purchase_id)
        WHERE review_status = 'pending';
    `);
  });
  console.log('Finance inventory purchase review is ready.');
}

if (require.main === module) {
  migrate()
    .catch((error) => {
      console.error('Finance inventory purchase review migration failed:', error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = migrate;
