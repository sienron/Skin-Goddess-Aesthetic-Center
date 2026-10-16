const db = require('../db');

const LEGACY_INFERRED_NOTE = 'Provisional starting suggestion inferred from service and product names/categories; not a verified clinic procedure. Validate product use and quantity with the clinic.';
const SAFE_NOTE = 'Legacy inferred candidate; clinic must confirm product use before enabling. No default quantity has been assumed.';

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        UPDATE service_inventory_product_defaults
        SET default_quantity = NULL,
            is_enabled = FALSE,
            review_note = $1,
            updated_at = NOW()
        WHERE updated_by IS NULL
          AND review_note = $2
      `, [SAFE_NOTE, LEGACY_INFERRED_NOTE]);
    });

    console.log('Legacy inferred inventory suggestions were reset to disabled, quantity-unconfirmed candidates.');
  } catch (error) {
    console.error('Inferred service inventory defaults migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
