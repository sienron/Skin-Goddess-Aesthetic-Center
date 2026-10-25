const db = require('../db');

async function migrate() {
  await db.transaction(async (client) => {
    const result = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'appointment_inventory_deductions' AND column_name = 'confirmed_at')
          OR (table_name = 'appointment_inventory_review_drafts' AND column_name = 'reviewed_at')
        )
    `);
    const columnTypes = new Map(
      result.rows.map(({ table_name, column_name, data_type }) => [
        `${table_name}.${column_name}`,
        data_type
      ])
    );

    for (const [tableName, columnName] of [
      ['appointment_inventory_deductions', 'confirmed_at'],
      ['appointment_inventory_review_drafts', 'reviewed_at']
    ]) {
      if (columnTypes.get(`${tableName}.${columnName}`) === 'timestamp without time zone') {
        await client.query(`
          ALTER TABLE ${tableName}
          ALTER COLUMN ${columnName} TYPE TIMESTAMPTZ
          USING ${columnName} AT TIME ZONE current_setting('TimeZone')
        `);
      }
    }
  });
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Appointment review timestamps now preserve their timezone.'))
    .catch((error) => {
      console.error('Appointment review timezone migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { migrate };
