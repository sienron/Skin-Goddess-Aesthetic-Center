# Live Render admin demo data

The live admin demo seed is an explicit, reversible database operation. It creates eight unmistakably named demo client accounts, historical and today's demo appointments, tagged finance payments, and tagged expenses. Demo accounts use reserved `.invalid` email addresses and random passwords that are not saved.

**These rows appear in production admin pages and finance totals while present.** Do not use the resulting finance reports as actual business figures until the demo data is cleared. The script does not change inventory stock, send messages, or create PayMongo transactions.

## Seed on Render

Run from the Render service shell after confirming it is connected to the intended production database:

```sh
npm run seed:live-demo -- --seed --confirm-live-demo-data --confirm-db "$DB_NAME"
```

The script requires `NODE_ENV=production`, an explicit confirmation flag, and a database-name confirmation matching both the service environment and the connected PostgreSQL database. Seeding is one transaction and refuses to create a second copy while a tracked demo dataset exists.

## Remove the demo data

Run this from the same Render service shell when the demo is over:

```sh
npm run seed:live-demo -- --clear --confirm-live-demo-data --confirm-db "$DB_NAME"
```

Cleanup deletes only IDs recorded for `live-admin-demo-v1`, in dependency order. If any demo appointment or payment has since been used by another workflow that restricts deletion, cleanup fails and rolls back instead of deleting those related records.
