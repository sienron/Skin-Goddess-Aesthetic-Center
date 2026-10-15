const db = require('../db');

const INFERRED_NOTE = 'Provisional starting suggestion inferred from service and product names/categories; not a verified clinic procedure. Validate product use and quantity with the clinic.';

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        UPDATE service_inventory_product_defaults mapping
        SET default_quantity = 1,
            is_enabled = TRUE,
            review_note = $1,
            updated_at = NOW()
        WHERE mapping.updated_by IS NULL
          AND mapping.is_enabled = FALSE
          AND mapping.default_quantity IS NULL
          AND mapping.review_note LIKE 'Provisional candidate%'
          AND NOT EXISTS (
            SELECT 1
            FROM service_inventory_product_defaults managed
            WHERE managed.service_id = mapping.service_id
              AND (managed.updated_by IS NOT NULL
                OR managed.review_note NOT LIKE 'Provisional candidate%')
          )
      `, [INFERRED_NOTE]);

      await client.query(`
        INSERT INTO service_inventory_product_defaults
          (service_id, product_id, default_quantity, is_enabled, review_note)
        SELECT service.service_id, product.product_id, 1, TRUE, $1
        FROM services service
        JOIN inventory_products product
          ON (CONCAT_WS(' ', service.service_name, service.description, service.category) ILIKE '%acne%'
              AND product.product_name IN ('Acne Buster Toner', 'Acne Topical Solution')
              AND product.category IN ('Facial/Treatment Prep Products', 'Skincare Products (Retail / Aftercare)'))
          OR (CONCAT_WS(' ', service.service_name, service.description, service.category) ILIKE '%drip%'
              AND product.product_name = 'Macroset (IV Set)'
              AND product.category = 'Medical/Injection Supplies')
          OR (CONCAT_WS(' ', service.service_name, service.description, service.category) ILIKE '%shot%'
              AND product.product_name = '3cc Syringe'
              AND product.category = 'Medical/Injection Supplies')
        WHERE NOT EXISTS (
          SELECT 1
          FROM service_inventory_product_defaults existing
          WHERE existing.service_id = service.service_id
        )
        ON CONFLICT (service_id, product_id) DO NOTHING
      `, [INFERRED_NOTE]);
    });

    console.log('Provisional service inventory suggestions are ready.');
  } catch (error) {
    console.error('Inferred service inventory defaults migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
