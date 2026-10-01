---
name: Setup Skin Goddess Locally
description: Set up this repository on a new laptop for safe local development and testing.
argument-hint: Choose whether to seed finance demo data
agent: agent
---

Set up this checkout for local development and testing on this machine only. Do not deploy, push, commit, or connect to Render or any other remote database.

## Safety gates

1. Confirm the workspace root and inspect `package.json`, `.env.example`, `db.js`, and the local setup/migration scripts.
2. Before running migrations or seed scripts, verify `NODE_ENV` is not `production`, `DB_HOST` is `localhost`, `127.0.0.1`, or another explicitly confirmed local PostgreSQL host, and `DB_NAME` is the intended local development database (normally `skin_goddess_test`). Report host/name only; never print `DB_PASSWORD`, connection URLs, API keys, or other secrets.
3. If the database target is Render, remote, or ambiguous, stop before any database write and ask the user to configure a local PostgreSQL database.
4. Never overwrite an existing `.env`. If setup needs credentials, show the required variable names and have the user enter secrets directly into their local `.env` or terminal. Never ask the user to paste secrets into chat.
5. Do not clear, replace, or delete existing database records. Before using `--clear` or reseeding, check for tagged demo rows and ask the user before removing them.

## Local configuration

Use the repository's existing Node.js and Express/PostgreSQL setup; do not add a framework or replace the database layer. Install dependencies with `npm ci` when a lockfile is present. Help the user configure an ignored local `.env` with the required `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL=false` values. Use `NODE_ENV=development` and `APP_BASE_URL=http://localhost:3000`. For local PayMongo checkout testing, use test credentials only and set `PAYMONGO_PAYMENT_METHODS=card,gcash,paymaya`; PayMongo secrets must remain private.

If the local database does not exist or PostgreSQL is unavailable, explain how to create/start a local database and stop before running migrations until the connection is confirmed local.

## Migrations and test access

After confirming the local database target, run `npm run migrate` from the workspace root and report the migration result. This runs the repository's established migration chain, including the local-development access migration.

Then run `node scripts/seed-local-dev-user.js` to create or refresh the dedicated `local-dev@skingoddess.test` admin. The script generates a password unless `LOCAL_DEV_PASSWORD` is supplied and prints it once; tell the user to store it locally and not share it. Its all-role access and MFA bypass must remain local-only: they are honored only when `NODE_ENV` is not `production`.

For finance sample data, first count rows tagged with `note = 'DEMO'` and expenses whose description starts with `DEMO:`. If tagged demo data already exists, ask whether to keep it or clear it before reseeding. If the user chooses to seed and no existing demo set would be duplicated, run `node scripts/seed-finance-demo.js`. The seed script must refuse production. Never run `--clear` without the user's confirmation.

## Start and verify

Run `node scripts/build-public.js`, check the changed JavaScript with `node --check`, then start the app with `npm start`. If port 3000 is already occupied, identify the listener before stopping anything; otherwise use an alternate local `PORT` without killing unrelated processes.

Give the user the local URL, the one-time dev admin credentials without exposing any database/provider secrets, and the Finance page URLs:
- `http://localhost:3000/FinanceDashboard.html`
- `http://localhost:3000/FinancesTransactions.html`
- `http://localhost:3000/FinanceExpenses.html`
- `http://localhost:3000/FinanceReports.html`

winget install ngrok.ngrok
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
ngrok http 3000

Verify `/api/auth/me` and a Finance page only after signing in locally. Confirm the Finance tabs load and note the active date range when demo data is outside the current month. If any check fails, report the exact sanitized error and stop rather than switching to a remote database.