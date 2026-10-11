const db = require('../db');

async function migrate() {
  try {
    await db.transaction(async (client) => {
      await client.query(`
        ALTER TABLE appointments
          DROP CONSTRAINT IF EXISTS appointments_appointment_status_check,
          ADD CONSTRAINT appointments_appointment_status_check
          CHECK (appointment_status IN (
            'pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
          ))
      `);

      await client.query(`
        ALTER TABLE appointments
          DROP CONSTRAINT IF EXISTS appointments_no_overlap,
          ADD CONSTRAINT appointments_no_overlap
          EXCLUDE USING gist (
            aesthetician_id WITH =,
            tsrange(
              appointment_date + appointment_time,
              appointment_date + appointment_end_time
            ) WITH &&
          )
          WHERE (appointment_status IN ('confirmed', 'in_progress', 'completed'))
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS service_inventory_product_defaults (
        service_id INTEGER NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES inventory_products(product_id) ON DELETE CASCADE,
        default_quantity INTEGER CHECK (default_quantity IS NULL OR default_quantity > 0),
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        review_note TEXT NOT NULL DEFAULT '',
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (service_id, product_id),
        CHECK (NOT is_enabled OR default_quantity IS NOT NULL)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_inventory_deductions (
        appointment_id INTEGER PRIMARY KEY REFERENCES appointments(appointment_id) ON DELETE RESTRICT,
        confirmed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        confirmed_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        ALTER TABLE inventory_transactions
          ADD COLUMN IF NOT EXISTS appointment_id INTEGER
            REFERENCES appointments(appointment_id) ON DELETE SET NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS inventory_transactions_appointment_idx
          ON inventory_transactions (appointment_id, created_at)
          WHERE appointment_id IS NOT NULL
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_inventory_review_drafts (
        appointment_id INTEGER PRIMARY KEY REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        selected_items JSONB NOT NULL DEFAULT '[]'::jsonb
          CHECK (jsonb_typeof(selected_items) = 'array'),
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP
        )
      `);
      await client.query(`
        ALTER TABLE appointment_inventory_review_drafts
          ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP
      `);

      await client.query(`
        INSERT INTO service_inventory_product_defaults
          (service_id, product_id, default_quantity, is_enabled, review_note)
        SELECT service.service_id, product.product_id, NULL, FALSE,
          'Provisional candidate based on matching service/product names; clinic must confirm product use and quantity before enabling.'
        FROM services service
        JOIN inventory_products product
          ON product.product_name IN ('Acne Buster Toner', 'Acne Topical Solution')
        WHERE service.service_name ILIKE '%acne%'
        ON CONFLICT (service_id, product_id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO service_inventory_product_defaults
          (service_id, product_id, default_quantity, is_enabled, review_note)
        SELECT service.service_id, product.product_id, NULL, FALSE,
          'Provisional candidate because the product is labeled IV Set and the service is a drip; clinic must confirm use and quantity before enabling.'
        FROM services service
        JOIN inventory_products product ON product.product_name = 'Macroset (IV Set)'
        WHERE service.service_name ILIKE '%drip%'
        ON CONFLICT (service_id, product_id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO service_inventory_product_defaults
          (service_id, product_id, default_quantity, is_enabled, review_note)
        SELECT service.service_id, product.product_id, NULL, FALSE,
          'Provisional candidate because the service is labeled as a shot; clinic must confirm syringe type, use, and quantity before enabling.'
        FROM services service
        JOIN inventory_products product ON product.product_name = '3cc Syringe'
        WHERE service.service_name ILIKE '%shot%'
        ON CONFLICT (service_id, product_id) DO NOTHING
      `);
    });

    console.log('Appointment inventory review schema is ready.');
  } catch (error) {
    console.error('Appointment inventory review migration failed:', error.message);
    process.exitCode = 1;
  }
}

migrate().finally(() => process.exit());
