const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('../migrations/registry.json');
const db = require('../db');
const {
  findPendingMigrations,
  requestedMigrations,
  run,
  validateRegistry,
  checksumContents,
} = require('../scripts/run-migrations');

test('migration checksums are identical across Windows and Linux line endings', () => {
  const lf='const value = 1;\nmodule.exports = value;\n';
  assert.equal(checksumContents(lf),checksumContents(lf.replace(/\n/g,'\r\n')));
  assert.notEqual(checksumContents(lf),checksumContents(lf.replace('1','2')));
});

test('migration registry covers every migration file with unique full-filename IDs', () => {
  assert.doesNotThrow(validateRegistry);
  assert.equal(new Set([...registry.required, ...registry.optional]).size,
    registry.required.length + registry.optional.length);
});

test('migration targets preserve registry order and stop at the requested filename', () => {
  const target = '033-finance-expense-edit-history.js';
  const selected = requestedMigrations([`--target=${target}`]);

  assert.deepEqual(selected, registry.required.slice(0, registry.required.indexOf(target) + 1));
  assert.equal(selected[selected.length - 1], target);
});

test('optional demo data is excluded unless explicitly requested', () => {
  const defaultSelection = requestedMigrations([]);
  const optedIn = requestedMigrations([
    '--target=000-init-schema.js',
    '--include-optional=043-demo-customer-appointments.js',
  ]);

  assert.equal(defaultSelection.includes('043-demo-customer-appointments.js'), false);
  assert.deepEqual(optedIn, [
    '000-init-schema.js',
    '043-demo-customer-appointments.js',
  ]);
});

test('unsafe migrations block the whole run before any migration can be marked applied', () => {
  assert.throws(
    () => findPendingMigrations(registry.required, new Map()),
    (error) => {
      assert.match(error.message, /blocked before executing any migration/);
      assert.match(error.message, /000-init-schema\.js/);
      assert.match(error.message, /not enclosed in one transaction/);
      return true;
    }
  );
});

test('fresh database preflight blocks before creating the ledger or running unsafe migrations', async () => {
  const originalConnect = db.pool.connect;
  const calls = [];
  db.pool.connect = async () => ({
    async query(sql) {
      calls.push(sql);
      if (/information_schema\.tables/.test(sql)) return { rows: [{ present: false }] };
      if (/to_regclass/.test(sql)) return { rows: [{ exists: false }] };
      return { rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(run([]), /000-init-schema\.js.*not enclosed in one transaction/);
    assert.equal(calls.some((sql) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)), false);
    assert.equal(calls.some((sql) => /pg_advisory_unlock/.test(sql)), true);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('untracked existing databases fail closed without an explicit baseline', async () => {
  const originalConnect = db.pool.connect;
  const originalAdoptionEnv = {
    database: process.env.MIGRATION_ADOPT_DATABASE,
    baseline: process.env.MIGRATION_BASELINE,
    confirmation: process.env.MIGRATION_ADOPT_CONFIRM,
  };
  const calls = [];
  delete process.env.MIGRATION_ADOPT_DATABASE;
  delete process.env.MIGRATION_BASELINE;
  delete process.env.MIGRATION_ADOPT_CONFIRM;
  db.pool.connect = async () => ({
    async query(sql) {
      calls.push(sql);
      if (/information_schema\.tables/.test(sql)) return { rows: [{ present: true }] };
      if (/to_regclass/.test(sql)) return { rows: [{ exists: false }] };
      if (/current_database/.test(sql)) return { rows: [{ name: 'legacy_database' }] };
      return { rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(run([]), /Untracked existing database "legacy_database".*Do not guess a baseline/);
    assert.equal(calls.some((sql) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)), false);
    assert.equal(calls.some((sql) => /pg_advisory_unlock/.test(sql)), true);
  } finally {
    db.pool.connect = originalConnect;
    for (const [name, value] of Object.entries({
      MIGRATION_ADOPT_DATABASE: originalAdoptionEnv.database,
      MIGRATION_BASELINE: originalAdoptionEnv.baseline,
      MIGRATION_ADOPT_CONFIRM: originalAdoptionEnv.confirmation,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
