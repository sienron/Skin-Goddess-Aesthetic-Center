const db = require('../db');

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS expense_edit_history (
          expense_edit_history_id BIGSERIAL PRIMARY KEY,
          expense_id INTEGER NOT NULL REFERENCES expenses(expense_id) ON DELETE RESTRICT,
          edited_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
          edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          previous_values JSONB NOT NULL
            CHECK (jsonb_typeof(previous_values) = 'object'),
          updated_values JSONB NOT NULL
            CHECK (jsonb_typeof(updated_values) = 'object'),
          CHECK (previous_values IS DISTINCT FROM updated_values)
        );

        CREATE INDEX IF NOT EXISTS expense_edit_history_expense_edited_idx
          ON expense_edit_history (expense_id, edited_at DESC, expense_edit_history_id DESC);
      `);
    });
    console.log('Finance expense edit-history schema is ready.');
  } catch (error) {
    console.error('Finance expense edit-history migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

migrate();
