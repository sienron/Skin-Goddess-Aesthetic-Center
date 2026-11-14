// Preview by default. Update only the eight source rows explicitly confirmed by the user.
const crypto = require('node:crypto');
const source = require('./data/october-2026-appointments.json');
const approval = require('./data/october-2026-service-prices.json');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const approvedRows = source.appointments.filter((row) => approval.mappings.some((mapping) => mapping.label === row.treatment));
const keys = approvedRows.map((row) => `client-october-2026:row:${row.row}`);

async function buildPricePlan(client) {
  const records = (await client.query(`SELECT to_jsonb(a) AS record, s.service_name, s.is_historical_only
    FROM appointments a JOIN services s USING(service_id)
    WHERE a.historical_import_key=ANY($1::text[]) ORDER BY a.historical_import_key`, [keys])).rows;
  if (records.length !== 8) throw new Error('Expected exactly eight approved October source rows.');
  const services = (await client.query(`SELECT service_id,service_name,service_price::text,is_active,is_historical_only
    FROM services WHERE service_name=ANY($1::text[]) ORDER BY service_id`,
  [approval.mappings.map((mapping) => mapping.service)])).rows;
  const changes = records.map(({ record, service_name, is_historical_only }) => {
    const original = approvedRows.find((row) => `client-october-2026:row:${row.row}` === record.historical_import_key);
    const mapping = approval.mappings.find((item) => item.label === original.treatment);
    const target = services.find((item) => item.service_name === mapping.service);
    if (!target?.is_active || target.is_historical_only || target.service_price !== mapping.price) {
      throw new Error(`Approved catalog service or price changed: ${mapping.service}.`);
    }
    if (record.appointment_id === 51 || record.user_id !== null || record.walk_in_name !== original.name
        || record.appointment_date !== original.date || record.appointment_status !== 'completed'
        || record.historical_source?.original_treatment !== original.treatment
        || record.historical_source?.sheet_row !== original.row) {
      throw new Error(`Source identity or treatment changed for ${record.historical_import_key}.`);
    }
    const audit = record.historical_source.catalog_reconciliation;
    const alreadyApplied = audit?.version === approval.version
      && record.service_id === target.service_id && record.booked_service_price !== null
      && Math.round(Number(record.booked_service_price) * 100) === Math.round(Number(mapping.price) * 100)
      && audit.catalog_service_id === target.service_id && audit.approved_service_price === mapping.price;
    if (!alreadyApplied && (audit || record.booked_service_price !== null
        || service_name !== original.treatment || !is_historical_only)) {
      throw new Error(`Existing pricing or service needs review for appointment ${record.appointment_id}.`);
    }
    return { id: record.appointment_id, key: record.historical_import_key, name: original.name,
      date: original.date, originalLabel: original.treatment, originalServiceId: record.service_id,
      serviceId: target.service_id, service: target.service_name, price: mapping.price, alreadyApplied };
  });
  const total = changes.reduce((sum, row) => sum + Math.round(Number(row.price) * 100), 0);
  if (total !== 1950000) throw new Error('Approved prices do not total PHP 19,500.');
  return { fingerprint: digest({ records, services, approval }), approvalVersion: approval.version,
    changes, updateCount: changes.filter((row) => !row.alreadyApplied).length,
    alreadyApplied: changes.filter((row) => row.alreadyApplied).length, salesTotal: total / 100 };
}

async function preservedState(client) {
  // Compare protected data in memory; never log account secrets or session contents.
  const result = await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY appointment_id) FROM appointments a WHERE NOT(historical_import_key=ANY($1::text[])) OR historical_import_key IS NULL) AS other_appointments,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY payment_id) FROM payments p) AS payments,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY user_id) FROM users u) AS users,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY product_id) FROM inventory_products p) AS stock,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY transaction_id) FROM inventory_transactions t) AS stock_transactions,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY service_id) FROM services s) AS services`, [keys]);
  return digest(result.rows[0]);
}

async function applyPricePlan(client, expectedFingerprint) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(5032026,1)');
    await client.query('LOCK TABLE appointments,services IN SHARE ROW EXCLUSIVE MODE');
    const plan = await buildPricePlan(client);
    if (!expectedFingerprint || expectedFingerprint !== plan.fingerprint) throw new Error('Pricing preview changed. Generate a fresh preview.');
    const protectedBefore = await preservedState(client);
    for (const change of plan.changes.filter((row) => !row.alreadyApplied)) {
      const before = (await client.query('SELECT to_jsonb(a) AS record FROM appointments a WHERE appointment_id=$1', [change.id])).rows[0].record;
      const audit = { version: approval.version, confirmed_on: approval.confirmedOn,
        confirmation: approval.confirmation, applied_at: new Date().toISOString(),
        original_service_id: change.originalServiceId, original_booked_service_price: before.booked_service_price,
        catalog_service_id: change.serviceId, catalog_service_name: change.service,
        approved_service_price: change.price };
      const saved = await client.query(`UPDATE appointments
        SET service_id=$2,booked_service_price=$3,
          historical_source=historical_source || jsonb_build_object('catalog_reconciliation',$4::jsonb),updated_at=NOW()
        WHERE appointment_id=$1 AND historical_import_key=$5 AND booked_service_price IS NULL
        RETURNING to_jsonb(appointments) AS record`, [change.id,change.serviceId,change.price,audit,change.key]);
      if (saved.rowCount !== 1) throw new Error(`Appointment ${change.id} changed during reconciliation.`);
      const after = saved.rows[0].record;
      for (const field of ['service_id','booked_service_price','historical_source','updated_at']) {
        delete before[field]; delete after[field];
      }
      if (digest(before) !== digest(after)) throw new Error(`Unexpected appointment change for ${change.id}.`);
    }
    const final = await buildPricePlan(client);
    if (final.alreadyApplied !== 8 || final.salesTotal !== 19500 || await preservedState(client) !== protectedBefore) {
      throw new Error('Reconciliation verification failed. Rolling back.');
    }
    await client.query('COMMIT');
    return { updated: plan.updateCount, alreadyApplied: plan.alreadyApplied, salesTotal: final.salesTotal,
      paymentRecordsCreated: 0, changes: plan.changes };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  require('dotenv').config({ quiet: true });
  const { Pool } = require('pg');
  const { getPostgresSslConfig } = require('../utils/postgresConfig');
  const args = process.argv.slice(2);
  const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const apply = args.includes('--apply');
  if (apply && (value('--expected-host') !== process.env.DB_HOST || value('--expected-database') !== process.env.DB_NAME)) {
    throw new Error('--apply requires an exact --expected-host and --expected-database match.');
  }
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: getPostgresSslConfig(),
    connectionTimeoutMillis: 15000, allowExitOnIdle: true });
  let client;
  try {
    client = await pool.connect();
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (database !== process.env.DB_NAME) throw new Error('Connected database does not match DB_NAME.');
    const result = apply ? await applyPricePlan(client,value('--fingerprint')) : await buildPricePlan(client);
    console.log(JSON.stringify({ target: { host: process.env.DB_HOST, database }, mode: apply ? 'applied' : 'preview', ...result }, null, 2));
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error('October pricing failed:',error.message); process.exitCode=1; });
module.exports = { approval, approvedRows, buildPricePlan, applyPricePlan };
