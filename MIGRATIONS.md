# Database migrations

The canonical migration order is recorded in `migrations/registry.json`. IDs are
the complete filenames, not numeric prefixes; several legacy files intentionally
share a numeric prefix. SQL companion files remain part of their owning
migration.

`npm start` runs the migration runner before building the public assets and
starting the server. `npm run migrate` uses the same runner. Feature-specific
`migrate:*` scripts are aliases into that registry. Use:

- `npm run migrate:validate` to check registry coverage and file presence without
  connecting to a database.
- `npm run migrate:status` to display applied, adopted, pending, or failed
  migration state for the configured database.
- `npm run migrate` to preflight and apply eligible registered migrations.

The runner serializes concurrent starts with a PostgreSQL advisory lock, records
the exact filename and SHA-256 checksum, and records a migration as applied
only after its child process exits successfully. A failed or interrupted
migration is not automatically repeated; inspect the database and ledger before
resolving it. It does not mark preflight-blocked migrations as failed or
completed. Optional demo-customer data is excluded from normal startup and is
available through `npm run migrate:demo-customer`.

## Legacy migration safety block

The migration audit found legacy scripts that use pool-level statements instead
of one migration-wide transaction. A later statement can fail after earlier
statements have committed, so the runner identifies these exact filenames in
`migrations/registry.json` and refuses the entire requested run before executing
any migration. It does not skip them. This currently blocks a complete fresh
installation and any upgrade that still has one of these migrations pending.

The safe remediation is to review each blocked migration against a disposable
database, prepare a transaction-safe replacement, and register it without
rewriting historical migration contents. Inventory migrations and Inventory
Management are explicitly out of scope and remain untouched; their pending
unsafe migrations therefore remain blocked. Do not run these scripts manually
against production or an unknown database. `npm start` remains blocked until
the database has a verified baseline and all required pending migrations have
safe replacements.

## Existing databases without a ledger

The repository's earlier migration chains did not track applied migration
history. The runner therefore fails closed when it finds application tables
without a ledger. Do not guess which scripts were applied. After verifying the
exact baseline using a database backup and schema/data review, a database
operator may perform one-time adoption by setting all of these environment
variables for a single startup:

```text
MIGRATION_ADOPT_DATABASE=<exact database name>
MIGRATION_BASELINE=<exact registered migration filename>
MIGRATION_ADOPT_CONFIRM=ADOPT:<exact database name>:<exact registered migration filename>
```

The runner records required migrations through the selected baseline as
`adopted` and applies later migrations normally. Remove the adoption variables
afterward. If the existing database's baseline is unknown, leave the variables
unset; startup remains blocked until its history is established.

Legacy migration scripts are run in isolated child processes because some
terminate their process or close their own pool. Their existing transaction
boundaries are preserved. The runner records and blocks failures, but it does not make a legacy script
transactional; review and repair any failed migration before resuming.
