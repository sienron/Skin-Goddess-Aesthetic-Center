# Inventory migrations

Run `npm run migrate:inventory-unit-price` after deploying the batch upload code.
Migration `026-inventory-unit-price.js` adds the nullable `unit_price` column used
by invoice batch uploads.
