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
