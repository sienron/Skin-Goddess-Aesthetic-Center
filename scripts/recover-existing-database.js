// One-time operator recovery for the audited legacy deployment. Preview is read-only.
const crypto = require('node:crypto');
const { auditLegacyMigrations } = require('./audit-legacy-migrations');
const { createLedger } = require('./run-migrations');

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const NEWSLETTER = '045-newsletter-subscribers.js';
const NEWSLETTER_REPAIR = `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  subscriber_id SERIAL PRIMARY KEY,email VARCHAR(254) NOT NULL,subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_lower_unique ON newsletter_subscribers(LOWER(email));`;

async function buildRecoveryPlan(client) {
  const exists = (await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists")).rows[0].exists;
  if (exists && (await client.query('SELECT 1 FROM schema_migrations LIMIT 1')).rowCount) {
    throw new Error('Migration history is already initialized. Use migrate:status instead of legacy recovery.');
  }
  const audit = await auditLegacyMigrations(client);
  const unsafe = audit.filter((row) => !row.verified && row.unsafe && row.filename !== NEWSLETTER);
  if (unsafe.length) throw new Error(`Unverified unsafe migrations require further review: ${unsafe.map((row) => row.filename).join(', ')}`);
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  const repairs = audit.filter((row) => !row.verified && row.filename === NEWSLETTER).map((row) => row.filename);
  return { database,fingerprint:hash({database,audit,repairs,repairChecksum:hash(NEWSLETTER_REPAIR)}),
    verified:audit.filter((row) => row.verified),repairs,
    pending:audit.filter((row) => !row.verified && !repairs.includes(row.filename)),audit };
}

async function tableHashes(client, tables) {
  const results = [];
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Unsupported table identifier.');
    const result = await client.query(`SELECT COUNT(*)::text AS count,
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash
      FROM "${table}" t`);
    results.push({table,...result.rows[0]});
  }
  return results;
}

async function recoverDatabase(client, expectedFingerprint) {
  // Use the same lock as startup so a Render retry cannot race adoption.
  await client.query('SELECT pg_advisory_lock(hashtext($1))',['skin-goddess-migration-runner']);
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    const plan=await buildRecoveryPlan(client);
    if (!expectedFingerprint || expectedFingerprint!==plan.fingerprint) throw new Error('Recovery preview changed. Generate a fresh audit.');
    const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map((row) => row.tablename);
    const before=await tableHashes(client,tables);
    // The only reviewed unsafe legacy operation needed here is empty-table DDL.
    // Execute its replacement inside this transaction; never replay old seed scripts.
    if(plan.repairs.includes(NEWSLETTER))await client.query(NEWSLETTER_REPAIR);
    const verified=await auditLegacyMigrations(client);
    if(verified.some((row) => !row.verified && row.unsafe))throw new Error('An unsafe migration is still unverified.');
    await createLedger(client);
    for(const row of verified.filter((entry) => entry.verified)) {
      await client.query(`INSERT INTO schema_migrations(migration_id,filename,checksum,status,started_at,applied_at)
        VALUES($1,$1,$2,'adopted',NOW(),NOW())`,[row.filename,row.checksum]);
    }
    const after=await tableHashes(client,tables);
    if(hash(before)!==hash(after))throw new Error('Existing business data changed during adoption. Rolling back.');
    await client.query('COMMIT');
    return {database:plan.database,adopted:verified.filter((row) => row.verified).map((row) => row.filename),
      repaired:plan.repairs,pending:verified.filter((row) => !row.verified).map((row) => row.filename),
      existingDataUnchanged:true,dataFingerprints:after};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))',['skin-goddess-migration-runner']);
  }
}

async function main() {
  require('dotenv').config({quiet:true});
  const db=require('../db');
  const args=process.argv.slice(2);
  const value=(name) => args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const apply=args.includes('--apply');
  if(apply && (value('--expected-host')!==process.env.DB_HOST || value('--expected-database')!==process.env.DB_NAME)) {
    throw new Error('Recovery --apply requires exact --expected-host and --expected-database values.');
  }
  let client;
  try {
    client=await db.pool.connect();
    const result=apply?await recoverDatabase(client,value('--fingerprint')):await buildRecoveryPlan(client);
    const report={...result};
    if(!apply) {
      delete report.audit;
      report.verifiedCount=result.verified.length;
      report.verified=result.verified.map((row) => row.filename);
      report.pending=result.pending.map((row) => row.filename);
    }
    console.log(JSON.stringify({mode:apply?'recovered':'preview',host:process.env.DB_HOST,...report},null,2));
  } finally {
    if(client)client.release();
    await db.pool.end();
  }
}

if(require.main===module)main().catch((error) => {console.error('Legacy recovery failed:',error.message);process.exitCode=1;});
module.exports={buildRecoveryPlan,recoverDatabase,tableHashes};
