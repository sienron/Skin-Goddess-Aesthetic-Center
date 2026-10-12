const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const db = require('../db');

const DATASET_KEY = 'live-admin-demo-v1';
const CLIENT_COUNT = 8;
const HISTORICAL_APPOINTMENT_COUNT = 10;
const TODAY_APPOINTMENT_COUNT = 4;
const PRODUCT_SALE_COUNT = 4;
const EXPENSE_COUNT = 8;
const PAYMENT_METHODS = ['gcash', 'maya', 'card'];
const EXPENSE_CATEGORIES = [
  'Inventory & Supplies',
  'Salaries & Commissions',
  'Rent',
  'Utilities',
  'Marketing',
  'Equipment Maintenance',
  'Other',
];

function parseOptions(args) {
  const options = {
    seed: args.includes('--seed'),
    clear: args.includes('--clear'),
    confirmed: args.includes('--confirm-live-demo-data'),
    confirmedDatabase: null,
  };

  const databaseIndex = args.indexOf('--confirm-db');
  if (databaseIndex !== -1) options.confirmedDatabase = args[databaseIndex + 1] || null;

  if (options.seed === options.clear) {
    throw new Error('Choose exactly one operation: --seed or --clear.');
  }
  if (!options.confirmed) {
    throw new Error('Pass --confirm-live-demo-data to explicitly authorize this production database operation.');
  }
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('This script only runs with NODE_ENV=production.');
  }
  if (!process.env.DB_NAME || options.confirmedDatabase !== process.env.DB_NAME) {
    throw new Error('Pass --confirm-db with the exact DB_NAME configured for this Render service.');
  }

  return options;
}

function dateOffset(today, daysAgo) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function assertProductionDatabase(client, configuredDatabase) {
  const result = await client.query('SELECT current_database() AS database_name');
  if (result.rows[0].database_name !== configuredDatabase) {
    throw new Error(
      `Connected database "${result.rows[0].database_name}" does not match confirmed DB_NAME "${configuredDatabase}". No demo data was written.`
    );
  }
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.demo_seed_records (
      dataset_key VARCHAR(80) NOT NULL,
      record_type VARCHAR(32) NOT NULL,
      record_id BIGINT NOT NULL,
      PRIMARY KEY (dataset_key, record_type, record_id)
    )
  `);
}

async function trackRecord(client, recordType, recordId) {
  await client.query(`
    INSERT INTO public.demo_seed_records (dataset_key, record_type, record_id)
    VALUES ($1, $2, $3)
  `, [DATASET_KEY, recordType, recordId]);
}

async function ensureNoExistingDemo(client) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM public.demo_seed_records WHERE dataset_key = $1',
    [DATASET_KEY]
  );
  if (result.rows[0].count > 0) {
    throw new Error('This demo dataset is already seeded. Run --clear first, or inspect public.demo_seed_records.');
  }
}

async function paymentMethodsAllowedByDatabase(client) {
  const result = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%method%'
  `);
  const constraints = result.rows.map((row) => row.definition);
  if (!constraints.length) {
    throw new Error('Could not verify the production payment-method constraint.');
  }

  const accepted = PAYMENT_METHODS.filter((method) => constraints.every((definition) => (
    definition.includes(`'${method}'`)
  )));
  if (!accepted.length) {
    throw new Error('The production payment-method constraint does not allow any supported demo payment methods.');
  }
  return accepted;
}

async function seedDemo(client) {
  await ensureTrackingTable(client);
  await ensureNoExistingDemo(client);

  const [todayResult, servicesResult] = await Promise.all([
    client.query(`SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date::text AS today`),
    client.query(`
      SELECT service_id, service_price, reservation_fee, duration_minutes
      FROM services
      WHERE is_active IS DISTINCT FROM FALSE
      ORDER BY service_id
    `),
  ]);
  const today = todayResult.rows[0].today;
  const services = servicesResult.rows;
  if (!services.length) throw new Error('No active services are available for demo appointments.');
  for (const service of services) {
    if (Number(service.duration_minutes) <= 0
      || Number(service.service_price) <= 0
      || Number(service.reservation_fee) <= 0
      || Number(service.reservation_fee) > Number(service.service_price)) {
      throw new Error(`Service ${service.service_id} has invalid pricing or duration for demo records.`);
    }
  }
  const todayServices = services.filter((service) => Number(service.duration_minutes) <= 120);
  if (!todayServices.length) {
    throw new Error('No active service is 120 minutes or shorter, so a non-overlapping demo schedule cannot be created.');
  }
  const paymentMethods = await paymentMethodsAllowedByDatabase(client);

  const clients = [];
  for (let index = 0; index < CLIENT_COUNT; index += 1) {
    const email = `demo-live-${String(index + 1).padStart(2, '0')}@example.invalid`;
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const result = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, email_verified, role)
      VALUES ($1, $2, 'Demo', $3, FALSE, 'client')
      RETURNING user_id
    `, [email, passwordHash, `Client ${String(index + 1).padStart(2, '0')}`]);
    const userId = result.rows[0].user_id;
    clients.push(userId);
    await trackRecord(client, 'user', userId);
  }

  for (let index = 0; index < HISTORICAL_APPOINTMENT_COUNT; index += 1) {
    const daysAgo = 55 - Math.round(index * 54 / (HISTORICAL_APPOINTMENT_COUNT - 1));
    const date = dateOffset(today, daysAgo);
    const service = services[(index * 3) % services.length];
    const startMinutes = 10 * 60 + 15;
    const endMinutes = startMinutes + Number(service.duration_minutes);
    if (endMinutes >= 24 * 60) throw new Error(`Service ${service.service_id} is too long for the demo appointment time.`);
    const startTime = '10:15:00';
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
    const isNoShow = index % 5 === 4;
    const status = isNoShow ? 'no_show' : 'completed';
    const price = Number(service.service_price);
    const deposit = Number(service.reservation_fee);
    const appointmentResult = await client.query(`
      INSERT INTO appointments (
        user_id, service_id, booked_service_price, booked_reservation_fee,
        payment_status, appointment_date, appointment_time, appointment_end_time,
        appointment_status, aesthetician_id, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, 'paid', $5::date, $6::time, $7::time,
        $8, NULL, ($5::date::timestamp + INTERVAL '12 hours'),
        ($5::date::timestamp + INTERVAL '12 hours')
      )
      RETURNING appointment_id
    `, [clients[index % clients.length], service.service_id, price, deposit, date, startTime, endTime, status]);
    const appointmentId = appointmentResult.rows[0].appointment_id;
    await trackRecord(client, 'appointment', appointmentId);

    const reservationPayment = await client.query(`
      INSERT INTO payments (
        appointment_id, payment_type, amount, method, reference_no, note, recorded_by,
        created_at
      )
      VALUES ($1, 'reservation', $2, $3, $4, 'DEMO LIVE: seeded admin demo', NULL,
        ($5::date::timestamp + INTERVAL '12 hours'))
      RETURNING payment_id
    `, [
      appointmentId,
      deposit,
      paymentMethods[index % paymentMethods.length],
      `DEMO-LIVE-DEP-${String(index + 1).padStart(4, '0')}`,
      date,
    ]);
    await trackRecord(client, 'payment', reservationPayment.rows[0].payment_id);

    if (!isNoShow && price > deposit) {
      const balancePayment = await client.query(`
        INSERT INTO payments (
          appointment_id, payment_type, amount, method, reference_no, note, recorded_by,
          created_at
        )
        VALUES ($1, 'balance', $2, $3, $4, 'DEMO LIVE: seeded admin demo', NULL,
          ($5::date::timestamp + INTERVAL '13 hours'))
        RETURNING payment_id
      `, [
        appointmentId,
        Math.round((price - deposit) * 100) / 100,
        paymentMethods[(index + 1) % paymentMethods.length],
        `DEMO-LIVE-BAL-${String(index + 1).padStart(4, '0')}`,
        date,
      ]);
      await trackRecord(client, 'payment', balancePayment.rows[0].payment_id);
    }
  }

  const todaySlots = ['09:00:00', '11:00:00', '13:00:00', '15:00:00'];
  for (let index = 0; index < TODAY_APPOINTMENT_COUNT; index += 1) {
    const service = todayServices[(index * 3) % todayServices.length];
    const startMinutes = Number(todaySlots[index].slice(0, 2)) * 60 + Number(todaySlots[index].slice(3, 5));
    const endMinutes = startMinutes + Number(service.duration_minutes);
    if (endMinutes >= 24 * 60) throw new Error(`Service ${service.service_id} is too long for the demo appointment time.`);
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
    const result = await client.query(`
      INSERT INTO appointments (
        user_id, service_id, booked_service_price, booked_reservation_fee,
        payment_status, appointment_date, appointment_time, appointment_end_time,
        appointment_status, aesthetician_id
      )
      VALUES ($1, $2, $3, $4, 'unpaid', $5::date, $6::time, $7::time, 'confirmed', NULL)
      RETURNING appointment_id
    `, [
      clients[(HISTORICAL_APPOINTMENT_COUNT + index) % clients.length],
      service.service_id,
      service.service_price,
      service.reservation_fee,
      today,
      todaySlots[index],
      endTime,
    ]);
    await trackRecord(client, 'appointment', result.rows[0].appointment_id);
  }

  for (let index = 0; index < PRODUCT_SALE_COUNT; index += 1) {
    const date = dateOffset(today, index * 9);
    const result = await client.query(`
      INSERT INTO payments (
        payment_type, amount, method, reference_no, note, recorded_by, created_at
      )
      VALUES ('product_sale', $1, $2, $3, 'DEMO LIVE: seeded admin demo', NULL,
        ($4::date::timestamp + INTERVAL '14 hours'))
      RETURNING payment_id
    `, [
      250 + index * 85,
      paymentMethods[index % paymentMethods.length],
      `DEMO-LIVE-PROD-${String(index + 1).padStart(4, '0')}`,
      date,
    ]);
    await trackRecord(client, 'payment', result.rows[0].payment_id);
  }

  for (let index = 0; index < EXPENSE_COUNT; index += 1) {
    const date = dateOffset(today, (index * 7) % 55);
    const category = EXPENSE_CATEGORIES[index % EXPENSE_CATEGORIES.length];
    const result = await client.query(`
      INSERT INTO expenses (
        expense_date, category, description, amount, supplier, reference_no, recorded_by
      )
      VALUES ($1::date, $2, $3, $4, $5, $6, NULL)
      RETURNING expense_id
    `, [
      date,
      category,
      `DEMO LIVE: ${category} sample expense ${index + 1}`,
      350 + index * 137.5,
      `Demo Supplier ${index % 4 + 1}`,
      `DEMO-LIVE-EXP-${String(index + 1).padStart(4, '0')}`,
    ]);
    await trackRecord(client, 'expense', result.rows[0].expense_id);
  }

  console.log(
    `Seeded ${CLIENT_COUNT} demo clients, ${HISTORICAL_APPOINTMENT_COUNT + TODAY_APPOINTMENT_COUNT} demo appointments, ` +
    `${PRODUCT_SALE_COUNT} product sales, and ${EXPENSE_COUNT} expenses. ` +
    `Payment methods allowed by this database: ${paymentMethods.join(', ')}.`
  );
}

async function clearDemo(client) {
  const tableResult = await client.query(`SELECT to_regclass('public.demo_seed_records') AS table_name`);
  if (!tableResult.rows[0].table_name) {
    console.log('No tracked live admin demo data was found.');
    return;
  }

  const tracked = await client.query(`
    SELECT record_type, array_agg(record_id) AS record_ids
    FROM public.demo_seed_records
    WHERE dataset_key = $1
    GROUP BY record_type
  `, [DATASET_KEY]);
  const ids = Object.fromEntries(tracked.rows.map((row) => [row.record_type, row.record_ids]));

  if (ids.payment?.length) {
    await client.query('DELETE FROM payments WHERE payment_id = ANY($1::bigint[])', [ids.payment]);
  }
  if (ids.expense?.length) {
    await client.query('DELETE FROM expenses WHERE expense_id = ANY($1::bigint[])', [ids.expense]);
  }
  if (ids.appointment?.length) {
    await client.query('DELETE FROM appointments WHERE appointment_id = ANY($1::bigint[])', [ids.appointment]);
  }
  if (ids.user?.length) {
    await client.query('DELETE FROM users WHERE user_id = ANY($1::bigint[])', [ids.user]);
  }
  await client.query('DELETE FROM public.demo_seed_records WHERE dataset_key = $1', [DATASET_KEY]);
  console.log('Removed only records tracked for live-admin-demo-v1.');
}

async function main() {
  let client;
  try {
    const options = parseOptions(process.argv.slice(2));
    client = await db.pool.connect();
    await assertProductionDatabase(client, options.confirmedDatabase);
    await client.query('BEGIN');
    if (options.seed) await seedDemo(client);
    else await clearDemo(client);
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Live admin demo operation failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await db.pool.end();
  }
}

if (require.main === module) main();

module.exports = { dateOffset, parseOptions };
