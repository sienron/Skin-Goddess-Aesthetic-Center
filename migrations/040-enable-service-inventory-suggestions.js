const db = require('../db');
const { buildCandidates } = require('./039-appointment-inventory-mappings');

async function migrate() {
  const candidates = buildCandidates();
  return db.transaction(async (client) => {
    const table = await client.query(
      `SELECT to_regclass('service_inventory_product_defaults') AS mapping_table`
    );
    if (!table.rows[0]?.mapping_table) {
      throw new Error('The service mapping table is missing; apply the appointment inventory schema migration first.');
    }

    await client.query(`
      ALTER TABLE service_inventory_product_defaults
      DROP CONSTRAINT IF EXISTS service_inventory_product_defaults_check
    `);

    const result = await client.query(`
      WITH candidates AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb)
          AS candidate(service_name TEXT, category TEXT, product_name TEXT, review_note TEXT)
      ),
      resolved AS (
        SELECT candidate.*,
               (SELECT COUNT(*) FROM services service
                WHERE service.service_name = candidate.service_name
                  AND service.category = candidate.category)::INTEGER AS service_matches,
               (SELECT MIN(service.service_id) FROM services service
                WHERE service.service_name = candidate.service_name
                  AND service.category = candidate.category) AS service_id,
               (SELECT COUNT(*) FROM inventory_products product
                WHERE product.product_name = candidate.product_name)::INTEGER AS product_matches,
               (SELECT MIN(product.product_id) FROM inventory_products product
                WHERE product.product_name = candidate.product_name) AS product_id
        FROM candidates candidate
      )
      INSERT INTO service_inventory_product_defaults
        (service_id, product_id, default_quantity, is_enabled, review_note)
      SELECT service_id, product_id, NULL, TRUE, review_note
      FROM resolved
      WHERE service_matches = 1 AND product_matches = 1
      ON CONFLICT (service_id, product_id)
      DO UPDATE SET is_enabled = TRUE, updated_at = NOW()
    `, [JSON.stringify(candidates)]);

    return {
      candidateCount: candidates.length,
      enabledCount: result.rowCount
    };
  });
}

if (require.main === module) {
  migrate()
    .then(({ candidateCount, enabledCount }) => {
      console.log(`Enabled or inserted ${enabledCount} service-product suggestions from ${candidateCount} candidates; no default quantities were assigned.`);
    })
    .catch((error) => {
      console.error('Enabling service inventory suggestions failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
