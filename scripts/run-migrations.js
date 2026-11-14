const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const db = require('../db');

const root = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const registry = require('../migrations/registry.json');
const lockName = 'skin-goddess-migration-runner';

function migrationPath(filename) {
  return path.join(migrationsDirectory, filename);
}

function checksumContents(contents) {
  return crypto.createHash('sha256').update(String(contents).replace(/\r\n/g, '\n')).digest('hex');
}

function checksum(filename) {
  return checksumContents(fs.readFileSync(migrationPath(filename), 'utf8'));
}

function validateRegistry() {
  const required = registry.required;
  const optional = registry.optional;
  const unsafe = registry.unsafeNonTransactional;
  if (!Array.isArray(required) || !Array.isArray(optional) || !Array.isArray(unsafe)) {
    throw new Error('Migration registry must define required, optional, and unsafe migration filename arrays.');
  }

  const allRegistered = [...required, ...optional];
  if (new Set(allRegistered).size !== allRegistered.length) {
    throw new Error('Migration registry contains duplicate migration identifiers.');
  }
  if (new Set(unsafe).size !== unsafe.length) {
    throw new Error('Unsafe migration registry contains duplicate identifiers.');
  }
  for (const filename of allRegistered) {
    if (path.basename(filename) !== filename || !filename.endsWith('.js')) {
      throw new Error(`Invalid migration identifier: ${filename}`);
    }
    for (const filename of unsafe) {
      if (!allRegistered.includes(filename)) {
        throw new Error(`Unsafe migration is not registered: ${filename}`);
      }
    }
    if (!fs.existsSync(migrationPath(filename))) {
      throw new Error(`Registered migration file is missing: ${filename}`);
    }
  }

  const registered = new Set(allRegistered);
  const unregistered = fs.readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.js') && !registered.has(filename));
  if (unregistered.length) {
    throw new Error(`Migrations are not registered: ${unregistered.join(', ')}`);
  }
}

function requestedMigrations(args) {
  const targetArg = args.find((arg) => arg.startsWith('--target='));
  const optionalArg = args.find((arg) => arg.startsWith('--include-optional='));
  let required = registry.required;

  if (targetArg) {
    const target = targetArg.slice('--target='.length);
    const index = required.indexOf(target);
    if (index < 0) throw new Error(`Unknown required migration target: ${target}`);
    required = required.slice(0, index + 1);
  }

  const requested = [...required];
  if (optionalArg) {
    const optional = optionalArg.slice('--include-optional='.length);
    if (!registry.optional.includes(optional)) {
      throw new Error(`Unknown optional migration: ${optional}`);
    }
    requested.push(optional);
  }
  return requested;
}

async function ledgerExists(client) {
  const result = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`);
  return result.rows[0].exists;
}

async function hasApplicationTables(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations'
    ) AS present
  `);
  return result.rows[0].present;
}

async function createLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'applied', 'adopted', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_at TIMESTAMPTZ,
      failure_message TEXT
    )
  `);
}

function adoptionPlan(databaseName) {
  const baseline = process.env.MIGRATION_BASELINE;
  const approvedDatabase = process.env.MIGRATION_ADOPT_DATABASE;
  const confirmation = process.env.MIGRATION_ADOPT_CONFIRM;
  const baselineIndex = registry.required.indexOf(baseline);
  const expectedConfirmation = `ADOPT:${databaseName}:${baseline || ''}`;

  if (approvedDatabase !== databaseName
    || baselineIndex < 0
    || confirmation !== expectedConfirmation) {
    throw new Error(
      `Untracked existing database "${databaseName}" detected. Startup is blocked. `
      + 'After verifying its exact migration baseline, set MIGRATION_ADOPT_DATABASE, '
      + 'MIGRATION_BASELINE, and MIGRATION_ADOPT_CONFIRM=ADOPT:<database>:<baseline-file> once. '
      + 'Do not guess a baseline.'
    );
  }

  return registry.required.slice(0, baselineIndex + 1);
}

async function recordAdoption(client, filenames) {
  for (const filename of filenames) {
    await client.query(`
      INSERT INTO schema_migrations
        (migration_id, filename, checksum, status, started_at, applied_at)
      VALUES ($1, $1, $2, 'adopted', NOW(), NOW())
      ON CONFLICT (migration_id) DO NOTHING
    `, [filename, checksum(filename)]);
  }
}

function findPendingMigrations(requested, rows) {
  const pending = [];
  for (const filename of requested) {
    const row = rows.get(filename);
    if (!row) {
      pending.push(filename);
      continue;
    }
    if (row.checksum !== checksum(filename)) {
      throw new Error(`Applied migration ${filename} has changed; restore its original contents and add a new migration.`);
    }
    if (row.status === 'applied' || row.status === 'adopted') continue;
    throw new Error(
      `Migration ${filename} is ${row.status}. It will not be rerun automatically; inspect the database and migration status first.`
    );
  }

  const unsafe = pending.filter((filename) => registry.unsafeNonTransactional.includes(filename));
  if (unsafe.length) {
    const details = unsafe.map((filename) => (
      `- ${filename}: legacy migration is not enclosed in one transaction; earlier statements may remain committed if a later statement fails.`
    ));
    throw new Error(
      `Migration run blocked before executing any migration. Unsafe legacy operations need reviewed, transaction-safe replacements:\n${details.join('\n')}`
    );
  }
  return pending;
}

async function migrationRows(client) {
  const result = await client.query(`
    SELECT migration_id, checksum, status, started_at, applied_at, failure_message
    FROM schema_migrations
  `);
  return new Map(result.rows.map((row) => [row.migration_id, row]));
}

function displayStatus(rows) {
  const entries = [...registry.required, ...registry.optional];
  console.log('Migration ID\tStatus\tApplied at\tFailure');
  for (const filename of entries) {
    const row = rows.get(filename);
    console.log([
      filename,
      row?.status || 'pending',
      row?.applied_at ? new Date(row.applied_at).toISOString() : '-',
      row?.failure_message || '-',
    ].join('\t'));
  }
  for (const [filename, row] of rows) {
    if (!entries.includes(filename)) {
      console.log([filename, row.status, row.applied_at || '-', row.failure_message || '-'].join('\t'));
    }
  }
}

async function applyMigration(client, filename, priorRows) {
  if (registry.unsafeNonTransactional.includes(filename)) {
    throw new Error(`Unsafe legacy migration ${filename} cannot be run automatically without a transaction-safe replacement.`);
  }
  const expectedChecksum = checksum(filename);
  const prior = priorRows.get(filename);
  if (prior) {
    if (prior.checksum !== expectedChecksum) {
      throw new Error(`Applied migration ${filename} has changed; restore its original contents and add a new migration.`);
    }
    if (prior.status === 'applied' || prior.status === 'adopted') return;
    throw new Error(
      `Migration ${filename} is ${prior.status}. It will not be rerun automatically; inspect the database and migration status first.`
    );
  }

  await client.query(`
    INSERT INTO schema_migrations
      (migration_id, filename, checksum, status, started_at)
    VALUES ($1, $1, $2, 'running', NOW())
  `, [filename, expectedChecksum]);

  const child = spawnSync(process.execPath, [migrationPath(filename)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) {
    const failure = child.error
      ? `Migration process could not be started: ${child.error.message}`
      : `Migration process exited with status ${child.status === null ? 'unknown' : child.status}.`;
    await client.query(`
      UPDATE schema_migrations
      SET status = 'failed', failure_message = $2
      WHERE migration_id = $1 AND status = 'running'
    `, [filename, failure]);
    throw new Error(`${filename} failed. ${failure} Review the database before any retry.`);
  }

  await client.query(`
    UPDATE schema_migrations
    SET status = 'applied', applied_at = NOW(), failure_message = NULL
    WHERE migration_id = $1 AND status = 'running'
  `, [filename]);
  priorRows.set(filename, {
    migration_id: filename,
    checksum: expectedChecksum,
    status: 'applied',
  });
}

async function run(args) {
  validateRegistry();
  const requested = requestedMigrations(args);
  const client = await db.pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
    locked = true;
    const hadApplicationTables = await hasApplicationTables(client);
    const hasLedger = await ledgerExists(client);
    let rows = hasLedger ? await migrationRows(client) : new Map();
    let adoption = [];
    if (hadApplicationTables && rows.size === 0) {
      const databaseName = (await client.query('SELECT current_database() AS name')).rows[0].name;
      adoption = adoptionPlan(databaseName);
      for (const filename of adoption) {
        rows.set(filename, {
          migration_id: filename,
          checksum: checksum(filename),
          status: 'adopted',
        });
      }
    }

    const pending = findPendingMigrations(requested, rows);
    if (adoption.length) {
      await client.query('BEGIN');
      try {
        await createLedger(client);
        await recordAdoption(client, adoption);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } else {
      await createLedger(client);
    }
    for (const filename of pending) await applyMigration(client, filename, rows);
    displayStatus(await migrationRows(client));
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    client.release();
  }
}

async function showStatus() {
  validateRegistry();
  const client = await db.pool.connect();
  try {
    if (!await ledgerExists(client)) {
      console.log(await hasApplicationTables(client)
        ? 'Existing database has no migration ledger; establish its baseline and perform explicit adoption.'
        : 'Migration ledger is not initialized; no application migrations have been applied.');
      return;
    }
    const rows = await migrationRows(client);
    if (rows.size === 0 && await hasApplicationTables(client)) {
      console.log('Existing database has an empty migration ledger; establish its baseline and perform explicit adoption.');
      return;
    }
    displayStatus(rows);
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--validate')) {
    validateRegistry();
    console.log(
      `Migration registry valid: ${registry.required.length} required, `
      + `${registry.optional.length} optional, and ${registry.unsafeNonTransactional.length} blocked legacy migrations.`
    );
    return;
  }
  if (args.includes('--status')) {
    await showStatus();
    return;
  }
  await run(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Migration runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { validateRegistry, requestedMigrations, findPendingMigrations, run, checksum, checksumContents, createLedger };
