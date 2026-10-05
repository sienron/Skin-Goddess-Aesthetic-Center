# Inventory migrations

Run `npm run migrate:inventory-transactions` and
`npm run migrate:inventory-unit-price` against the configured database before
using inventory transaction history and invoice batch uploads.

Migration `024-inventory-transaction-log.js` adds the transaction product name
and aligns the transaction schema with inventory history. Migration
`026-inventory-unit-price.js` adds the nullable `unit_price` column used by
invoice batch uploads.
