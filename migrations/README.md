# Inventory migrations

Run `npm run migrate:inventory-transactions` and
`npm run migrate:inventory-unit-price` against the configured database before
using inventory transaction history and invoice batch uploads.

Migration `024-inventory-transaction-log.js` adds the transaction product name
and aligns the transaction schema with inventory history. Migration
`026-inventory-unit-price.js` adds the nullable `unit_price` column used by
invoice batch uploads.

The standard `npm run migrate` command runs `postmigrate`, which applies
`047-flexible-appointment-scheduling.js` and
`048-appointment-delay-retries.js` and
`049-consolidate-aesthetician-roles.js`. Migration 047 adds configurable service
buffers, appointment duration snapshots and expected-end audit/notification
tables while preserving existing appointment end times. Migration 048
consolidates delay tracking to one row per affected appointment, adds bounded
retry state, and marks durations backfilled from legacy records as estimates.
Migration 049 converts former nail-service staff accounts to the aesthetician
role while preserving their account IDs and existing appointment assignments.
The original treatment duration for historical appointments cannot be
reconstructed reliably from the old schema; the reserved appointment period
remains intact, but the service duration is exposed as unavailable for those
records rather than represented as historically exact.

# Clinic Management

Run `npm run migrate:clinic-management` before starting the updated app against
an existing database. The standard `npm run migrate` also runs migration 050
through `postmigrate`. Then rebuild public assets (`node scripts/build-public.js`)
and restart the app (`npm start` rebuilds assets automatically).

Migration 050 adds weekly operating hours, closure history, appointment impact
records, and durable email delivery records. Initial hours preserve the existing
9 AM–6 PM schedule on all seven days; the noon–1 PM lunch break, 30-minute
booking interval, service duration/buffer, lead time, and advance window remain.
It does not change existing appointments, payment records, or permissions.

The Admin sidebar and dashboard open `ClinicManagement.html`. Changes require
an affected-appointment preview, and confirmation rechecks it under a database
lock. A booking made after preview requires another review. Database triggers
also guard payment callbacks and resolve impact records when the existing
appointment workflows reschedule or cancel appointments. Pending Resolution is
separate from the appointment's original status. Reminders and automatic status
advancement skip unresolved appointments.

Notifications use the existing `notifications` table and Brevo mailer. Email
delivery runs immediately after schedule changes and every minute through the
existing notification jobs. There are three automatic attempts, durable claim
records, unique recipient/event keys, and persisted Brevo UUID idempotency keys.
Admins can inspect failures and retry emails without duplicating bell entries.
An email marked `sent` means Brevo accepted it, rather than confirmed inbox delivery.
The API behavior follows [Brevo's idempotency documentation](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

`npm run test:clinic` runs the schedule unit tests. The PostgreSQL/HTTP suite also
runs when `CLINIC_TEST_DATABASE` equals `DB_NAME`, the name starts with
`sg_clinic_test`, and the connection is `127.0.0.1:55439`. Use a disposable local
database with the full existing migrations applied: the suite truncates test
appointment/clinic tables and mocks Brevo requests. It checks permissions,
multi-date closures, preview conflicts, concurrent bookings, database guards,
existing rescheduling/cancellation, email failures, retries, and duplicate prevention.
