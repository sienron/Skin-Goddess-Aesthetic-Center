This is a one-time replacement of the reviewed test data with the client's
October 2026 appointment sheet. Local and live currently share the same Render
database, so apply it only once to that database.

The maintenance command preserves Mark Sienron Aguilar (user 28), appointment 51,
his reservation payment, all staff accounts, inventory quantities and inventory
transaction history. Deletion is restricted to 41 appointment IDs and 13 client
IDs reviewed on November 14, 2026. Newly created records are outside that list.
Related test checkouts, appointment notes, ratings, inventory review markers,
clinic impact/delivery records, session records and appointment notifications are
removed with the selected test records. Inventory transaction links become NULL;
the stock ledger and stock balances remain unchanged.

`data/october-2026-appointments.json` transcribes the screenshot, including sheet
row numbers. It contains 21 appointments for 15 named clients, stored as walk-ins
because the source does not provide account email addresses. Six rows containing
12.12, 10.1 or 5.5 are excluded. They are not pending appointments in the app.

Treatments retain the original source labels; abbreviations and combinations are
not guessed or split. Record-only treatment labels are inactive and excluded from
service management and booking. Appointments use Completed based on the user's
assessment of the client record. Start/end times are admin-assigned in 90-minute
slots inside saved clinic hours, avoiding noon–1 PM. Actual duration is marked
unrecorded. Prices, reservation fees, payment status and staff are unrecorded;
the import creates no payments, inventory deductions, login accounts or ratings.

Preview (read-only):

```powershell
npm run maintenance:october-appointments
```

Before applying, take a verified PostgreSQL backup outside the repository. Review
the preview's target, selected IDs, source rows, assigned times and fingerprint.
The application then accepts only that exact preview and database target:

```powershell
node scripts/replace-test-appointments.js --apply --expected-host HOST --expected-database DATABASE --fingerprint PREVIEW_FINGERPRINT
```

The schema migration and replacement run in one database transaction. A protected
identity mismatch, changed preview, foreign-key failure, staff/stock change, or
incorrect import count rolls everything back. The import keys make a repeat run
leave existing imported rows alone. Conflicting imported rows require review.
`npm run migrate:historical-appointments` applies only the supporting schema;
ordinary migrations never run the destructive cleanup automatically.

Rebuild assets with `node scripts/build-public.js` and restart/deploy the app to
show the assigned-time labels and keep historical services out of management.
Select October 2026 on the appointments page to see the imported records.

The integration test requires a restored disposable copy at
127.0.0.1:55440, database `sg_october_import_test`, with
`OCTOBER_IMPORT_TEST_DATABASE=sg_october_import_test` and matching DB variables.
It deliberately deletes the reviewed test rows in that disposable copy. It
checks rollback, protected identity, prices, payments, stock, repeat runs, API
listing, catalog filtering and XLSX output. Without that environment, only the
source and scheduling unit tests run.

On November 15, 2026 the user confirmed six source labels against five catalog
services and confirmed the same client-approved rates applied in October:
ECT → Warts & Milia Removal (PHP 3,000); SF / Signature facial → RM Signature
Facial (PHP 1,500); Bf → Basic Facial (PHP 1,000); BF/MB → Basic Facial w/
Microboost (PHP 5,000); Meso Face / Fvl → Mesotherapy - Face w/ V-Lifting
(PHP 3,000). These cover eight appointments, totaling PHP 19,500. The other
thirteen October records still need service/price confirmation.

`npm run maintenance:october-prices` previews this separate reconciliation.
Apply with `node scripts/reconcile-october-prices.js --apply --expected-host HOST
--expected-database DATABASE --fingerprint PREVIEW_FINGERPRINT` after a backup.
The preview checks source identity, all eight source rows, active catalog names
and the exact approved prices. Changes are transactional and repeatable. Only
service linkage, the price snapshot, reconciliation metadata and updated_at
change. Source labels and pre-reconciliation service IDs remain in the audit
metadata; the original import preview still recognizes those source labels.

The prices contribute to sales earned on the original October appointment dates.
Payment status stays not_recorded and no payments are created. Unknown payment
history is excluded from confirmed receivables; the Finance appointment details
explain that the outstanding balance is unknown. Collections, staff, actual
durations, assigned times, reservation fees, inventory and Mark's records are
preserved. Deploy/restart the updated app for the unknown-balance display and
receivables filtering; pricing itself is shared database data.

`tests/october-price-reconciliation.test.js` checks rollback after partial
updates, changed source/rate rejection, repeat runs, original import compatibility
and actual Finance API totals. Its database test runs only with matching local
DB variables and OCTOBER_PRICING_TEST_DATABASE at 127.0.0.1:55440, with a database
name matching sg_october_pricing_test followed by an underscore and digits.
