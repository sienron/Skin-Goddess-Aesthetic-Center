# Survey demo customer

The survey uses one shared customer account, `demo.client@skingoddess.test`,
with four completed, synthetic appointments. No staff account is created.
Synthetic appointment rows are marked with `appointments.is_demo`, omitted
from operational appointment and finance reports, labeled in customer history,
and protected from customer mutations and payment operations.

## Shared-database safety

This option stores the demo account and its marked appointments in the
configured PostgreSQL database alongside existing application data. The
customer role remains unchanged and cannot access admin pages or APIs. Its
history query is scoped to the authenticated user ID. Never expose database
credentials, staff/admin credentials, production secrets, or admin APIs to
survey participants.

`DEMO_CUSTOMER_MFA_BYPASS=true` is an explicit production-only setting. It
changes MFA behavior only for the exact demo email when the account role is
`client` and `mfa_enabled` is false. It does not depend on database-name
matching and does not change MFA behavior for other customers or staff. Keep
the setting false until the demo account and required migration are ready.
PayMongo operations are blocked for the demo customer; Brevo email delivery
to or for the exact demo email is blocked independently of this MFA setting.

## Database setup

The app's PostgreSQL pool uses the explicit `DB_HOST`, `DB_PORT`, and
`DB_NAME` settings (as configured for the Render service), not a connection URL.
The migration and every seed operation require separate expected values:
`DEMO_CUSTOMER_TARGET_HOST`, `DEMO_CUSTOMER_TARGET_PORT`, and
`DEMO_CUSTOMER_TARGET_DATABASE`. Obtain the host, port, and database name from
the approved Render service configuration and verify them against the intended
database resource in the provider dashboard. Do not infer the endpoint from
the database name or copy a production endpoint into another environment.

Before any setup operation, the code checks that the expected host and port
exactly match `DB_HOST` and `DB_PORT`, then checks `current_database()` on the
connection established by the app's PostgreSQL pool. It intentionally does
not compare `inet_server_addr()` to DNS results: Render documents connections
through internal or external hostnames and recommends using the hostname
rather than a previously resolved IP, so the backend server address need not
be the endpoint hostname's DNS address. The approved target host, port, and
database must still be verified against the intended Render database in the
provider dashboard. Missing target values, host/port mismatches, or a
`current_database()` mismatch fail closed before migration or account data
changes. This check confirms the configured connection endpoint and connected
database name; it is not an independent provider-side resource identifier.
See Render's [PostgreSQL connection documentation](https://render.com/docs/postgresql-creating-connecting).

After separate approval to use the database, set the verified target values
from the Render/provider configuration and apply only the additive demo marker
migration:
```text
NODE_ENV=production
DEMO_CUSTOMER_TARGET_DATABASE=<exact configured database name>
DEMO_CUSTOMER_TARGET_HOST=<exact verified PostgreSQL host used by DB_HOST>
DEMO_CUSTOMER_TARGET_PORT=<exact verified PostgreSQL port used by DB_PORT>
DEMO_CUSTOMER_SETUP_CONFIRM=ADD_DEMO_APPOINTMENT_MARKER_TO_SHARED_DATABASE
```

Keep `DEMO_CUSTOMER_MFA_BYPASS=false` during this migration. Run this command
only after independently confirming the configured target values:
```sh
npm run migrate:demo-customer
```

After the migration succeeds, and when the shared account is ready to be
created, enable the bypass and change the operation confirmation:

```text
DEMO_CUSTOMER_MFA_BYPASS=true
DEMO_CUSTOMER_SETUP_CONFIRM=CREATE_DEMO_CUSTOMER_IN_SHARED_DATABASE
DEMO_CUSTOMER_CREDENTIAL_FILE=<new path outside the repository>
```

Run `npm run seed:demo-customer -- --create` only after approval. The setup
script refuses to overwrite an existing account, verifies the connected host,
port, and database against the explicit target values, creates the password
with a cryptographically secure random generator, and writes credentials only
to a new file outside the repository. On Windows it disables inherited file
ACLs, grants Full Control only to the current operator and SYSTEM, and verifies
the resulting ACL before writing any credential contents. On other platforms
it sets and verifies mode `0600`. The password is not printed. Remove the
credential file after securely distributing the shared survey credential. Do
not copy production secrets into a separate environment.

The seed inserts the account and all four appointments in one transaction.
The unique email constraint and existing-account check prevent a retry from
creating a second account. If the script reports an unknown `COMMIT` outcome,
it preserves the credential file and explicitly warns not to retry yet. Check
the target database for the demo email and exactly four `is_demo=true`
appointments. If all five rows exist, use the preserved credentials; if none
exist, remove the orphaned credential file and retry. A partial committed
state is not expected because all inserts use the same transaction.

The migration is additive and is not included in the existing production
migration chain. The existing migration list and staff seed migrations remain
unchanged.

## Disable or retire after the survey

To suspend access while retaining the account and its appointment history,
set `DEMO_CUSTOMER_SETUP_CONFIRM=SUSPEND_DEMO_CUSTOMER_IN_SHARED_DATABASE` and
run:

```sh
npm run seed:demo-customer -- --disable
```

To remove the account and its synthetic test data, set
`DEMO_CUSTOMER_SETUP_CONFIRM=RETIRE_DEMO_CUSTOMER_AND_APPOINTMENTS` and run:

```sh
npm run seed:demo-customer -- --retire
```

Retirement is transactional and proceeds only when the exact demo customer
owns exactly four `is_demo=true` appointments and no non-demo appointments.
Foreign-key or other database errors abort the transaction. Remove the
credential file separately. Do not run these operations until the target
database has been explicitly approved.

## Validation boundary

Previously recorded disposable-PostgreSQL testing exercised the actual
migration and seed JavaScript scripts and reported successful creation,
duplicate refusal, disable, retirement, rollback/error recovery, fixture
preservation, and selected finance exclusions. These are historical test
results, not a fresh run or independent verification for this update. Windows
credential-file ACL verification was also previously recorded; it was not
repeated here.

Database-free tests cover exact-account MFA eligibility, role access,
authenticated customer-history scoping, shared-account change restrictions,
and email/payment guards. This update adds database-free checks for endpoint
verification and rating-query exclusions. The finance integration suite was
not rerun after its cancelled-count assertion was corrected. No migration,
seed, disable, or retirement operation was run for this update. The deployed
Render target, production environment values, live PayMongo/Brevo behavior,
and production data isolation have not been independently verified and must
be confirmed before survey access is enabled.
