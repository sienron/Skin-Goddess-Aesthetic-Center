# Finance integration test

The Finance integration test writes and deletes PostgreSQL records. Run it only against a newly created, disposable database that is separate from the database configured for the application. The test does not run migrations.

## Schema and migrations

Use the repository migration runner on the disposable database before running the test:

```powershell
$env:DB_HOST = "<disposable database host>"
$env:DB_PORT = "5432"
$env:DB_USER = "<disposable database user>"
$env:DB_PASSWORD = "<disposable database password>"
$env:DB_NAME = "skin_goddess_finance_it_disposable"
npm run migrate
```

Run the complete required migration registry, rather than cherry-picking Finance migrations: the test also depends on the application's user, service, appointment, notification, and inventory schema. Relevant schema changes include `000-init-schema.js`, `001-appointments-hardening.js`, `004-inventory.js`, `006-user-management-columns.js`, `006-no-show-status.js`, `015-notifications.js`, `021-finance.js`, `022-paymongo-payment-methods.js`, `024-inventory-transaction-log.js`, `026-inventory-unit-price.js`, `030-payment-reversals.js`, `031-finance-product-sales-purchases.js`, `032-finance-dashboard-cash-closing.js`, `033-finance-expense-edit-history.js`, `052-finance-client-product-sales.js`, and `056-finance-payment-idempotency.js`. The authoritative ordered list is `migrations/registry.json`.

The test verifies that it connected to the exact requested database and the `public` schema; that required tables and columns exist (see `requireIsolatedReadyDatabase` in `tests/finance.integration.test.js`); and that payment constraints support `reversed` status and the `gcash` method.

## Test configuration

After migrations complete, remove the `DB_NAME` override before starting the test. The safety guard rejects a target database whose name matches either the repository-configured `DB_NAME` or the process `DB_NAME`; the test sets its own `DB_*` connection variables only after this check.

```powershell
Remove-Item Env:DB_NAME -ErrorAction SilentlyContinue

$env:NODE_ENV = "test"
$env:FINANCE_IT_ENVIRONMENT = "disposable"
$env:FINANCE_IT_DB_NAME = "skin_goddess_finance_it_disposable"
$env:FINANCE_IT_APPROVED_DATABASE = $env:FINANCE_IT_DB_NAME
$env:FINANCE_IT_APPROVAL = "I_APPROVE_WRITES_TO:$env:FINANCE_IT_DB_NAME"
$env:FINANCE_IT_DB_HOST = "<disposable database host>"
$env:FINANCE_IT_DB_PORT = "5432"
$env:FINANCE_IT_DB_USER = "<disposable database user>"
$env:FINANCE_IT_DB_PASSWORD = "<disposable database password>"
$env:FINANCE_IT_DB_SSL = "false" # optional; must be "true" or "false" if set

npm run test:finance:integration
```

Keep the application's `.env` `DB_NAME` pointed at its normal database, and do not set the process `DB_NAME` to the disposable target when invoking the test. Required variables are `NODE_ENV`, `FINANCE_IT_ENVIRONMENT`, `FINANCE_IT_DB_NAME`, `FINANCE_IT_APPROVED_DATABASE`, `FINANCE_IT_APPROVAL`, `FINANCE_IT_DB_HOST`, `FINANCE_IT_DB_PORT`, `FINANCE_IT_DB_USER`, and `FINANCE_IT_DB_PASSWORD`. `FINANCE_IT_DB_SSL` is optional.

## Safety checks, fixtures, and cleanup

Before writing, the test refuses to proceed unless the database name matches both approval values, differs from the repository-configured database, the port and optional SSL setting are valid, the schema checks pass, and the `public` schema is active. It also requires empty baseline scopes for appointments, cash closings, expenses, expense edit history, notifications, payment reversals, payments, product-sale details, and active admin/finance-officer users. These checks do not prove every table in the database is empty, which is why a separate disposable database is mandatory.

The fixtures include three users, one service, eight appointments, one inventory product, eight initial payments, and an expense. The API tests add a cash payment, a product sale, a non-cash payment, a cash closing, and a second expense; a concurrent payment may also be created. They exercise a refund status update, a payment reversal, sale details and inventory transactions, an expense edit-history record, and a cash-closing discrepancy notification.

The `after` hook deletes tracked edit-history, expenses, reversals, sale details, cash closings, payments, appointments, inventory transactions, the inventory product, service, and users in dependency order, inside a database transaction. The notification is removed by the `ON DELETE CASCADE` user foreign key from `015-notifications.js`. No migration is run by the test. If cleanup fails, the test reports that failure; discard the disposable database rather than reusing it.
