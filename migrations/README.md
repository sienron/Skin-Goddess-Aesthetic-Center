# Migration notes

## Running migrations

The canonical migration order and required, optional, and unsafe migration
filenames are recorded in [`registry.json`](registry.json). IDs are complete
filenames, not numeric prefixes; some legacy files intentionally share a
prefix. SQL companion files remain part of their owning migration.

`npm start` runs the migration runner before building public assets and starting
the server. `npm run migrate` uses the same runner, and feature-specific
`migrate:*` scripts are aliases into the same registry. These commands do not
run independent migration chains. Use `npm run migrate:validate` to check
registry coverage and file presence without connecting to a database.
`npm run migrate:status` reports the configured database's migration state.

The runner serializes concurrent starts with a PostgreSQL advisory lock, records
the exact filename and SHA-256 checksum, and records a migration as applied
only after its child process exits successfully. A failed or interrupted
migration is not automatically repeated; inspect the database and ledger before
resolving it. Preflight-blocked migrations are not recorded as failed or
completed. Optional demo-customer data is excluded from normal startup and is
available through `npm run migrate:demo-customer`.

### Existing databases without a known migration baseline

Earlier migration chains did not track applied migration history. If the runner
finds application tables without a populated migration ledger, it fails closed.
Do not guess which migrations have been applied. Verify the exact baseline using
a database backup and schema/data review, then have a database operator perform
one-time adoption by setting all of these environment variables for a single
startup:

```text
MIGRATION_ADOPT_DATABASE=<exact database name>
MIGRATION_BASELINE=<exact registered migration filename>
MIGRATION_ADOPT_CONFIRM=ADOPT:<exact database name>:<exact registered migration filename>
```

The runner records required migrations through the selected baseline as
`adopted` and applies later migrations normally. Remove the adoption variables
afterward. If the existing database's baseline is unknown, leave the variables
unset; startup remains blocked until its history is established.

### Unsafe legacy migrations

Some legacy migrations are not enclosed in one migration-wide transaction, so
earlier statements may commit even if a later statement fails. The runner lists
these exact filenames in `registry.json` and fails the entire requested run
before executing any migration when one of them is pending. It does not skip
them, and feature-specific aliases do not bypass this check. This currently
blocks a complete fresh installation and upgrades with a pending unsafe
migration, including affected inventory migrations.

Review each blocked migration against a disposable database and prepare a
transaction-safe replacement without rewriting historical migration contents.
Do not run unsafe scripts manually against production or an unknown database.
Inventory migration contents are explicitly out of scope and remain untouched;
pending unsafe inventory migrations therefore remain blocked.
The runner executes legacy scripts in isolated child processes, preserving
their existing transaction boundaries; it does not make them transactional.
Inspect the database and migration status after a failure before resolving or
retrying it.

## Historical migration notes

### Inventory transactions and unit prices

Migrations `024-inventory-transaction-log.js` and
`026-inventory-unit-price.js` add the transaction product name, align the
transaction schema with inventory history, and add the nullable `unit_price`
column used by invoice batch uploads. These are historical descriptions, not
instructions to run separate migration chains. Pending unsafe inventory
migrations remain blocked by the central runner.

### Appointment scheduling

Migration 047 adds configurable service buffers, appointment duration snapshots
and expected-end audit/notification tables while preserving existing
appointment end times. Migration 048 consolidates delay tracking to one row per
affected appointment, adds bounded retry state, and marks durations backfilled
from legacy records as estimates. Migration 049 converts former nail-service
staff accounts to the aesthetician role while preserving their account IDs and
existing appointment assignments. The original treatment duration for
historical appointments cannot be reconstructed reliably from the old schema;
the reserved appointment period remains intact, but the service duration is
exposed as unavailable for those records rather than represented as
historically exact.

### Clinic management

Migration 050 adds weekly operating hours, closure history, appointment impact
records, and durable email delivery records. Initial hours preserve the
existing 9 AM–6 PM schedule on all seven days; the noon–1 PM lunch break,
30-minute booking interval, service duration/buffer, lead time, and advance
window remain. It does not change existing appointments, payment records, or
permissions.

The Admin sidebar and dashboard open `ClinicManagement.html`. Changes require
an affected-appointment preview, and confirmation rechecks it under a database
lock. A booking made after preview requires another review. Database triggers
also guard payment callbacks and resolve impact records when the existing
appointment workflows reschedule or cancel appointments. Pending Resolution is
separate from the appointment's original status. Reminders and automatic status
advancement skip unresolved appointments.

### Finance inventory purchase review

Migration `053-finance-inventory-purchase-review.js` marks already-linked
purchase expenses as approved and adds pending/approved/rejected status plus
reviewer, rejection-reason, and rejection-time audit fields.

Notifications use the existing `notifications` table and Brevo mailer. Email
delivery runs immediately after schedule changes and every minute through the
existing notification jobs. There are three automatic attempts, durable claim
records, unique recipient/event keys, and persisted Brevo UUID idempotency keys.
Admins can inspect failures and retry emails without duplicating bell entries.
An email marked `sent` means Brevo accepted it, rather than confirmed inbox
delivery. The API behavior follows
[Brevo's idempotency documentation](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

`npm run test:clinic` runs the schedule unit tests. The PostgreSQL/HTTP suite
also runs when `CLINIC_TEST_DATABASE` equals `DB_NAME`, the name starts with
`sg_clinic_test`, and the connection is `127.0.0.1:55439`. Use a disposable
local database with the full existing migrations applied: the suite truncates
test appointment/clinic tables and mocks Brevo requests. It checks permissions,
multi-date closures, preview conflicts, concurrent bookings, database guards,
existing rescheduling/cancellation, email failures, retries, and duplicate
prevention.
