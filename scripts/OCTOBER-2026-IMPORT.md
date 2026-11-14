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
