const db = require('../db');

async function migrate() {
    try {
        await db.query(`
            ALTER TABLE inventory_products
            ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2)
                CHECK (unit_price IS NULL OR unit_price >= 0)
        `);
        console.log('Inventory unit price column is ready.');
    } catch (error) {
        console.error('Inventory unit price migration failed:', error.message);
        process.exitCode = 1;
    } finally {
        await db.pool.end();
    }
}

migrate();
