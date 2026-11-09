# Privileged account MFA

Admin and finance-officer accounts require an authenticator-app TOTP after password verification. Email login OTP and remembered devices remain available only to clients; they do not satisfy privileged MFA.

## Deployment

1. Set `NODE_ENV=production` explicitly. Application startup fails if `NODE_ENV` is missing or is not `development` or `production`.
2. Configure stable `SESSION_SECRET` and `MFA_ENCRYPTION_KEY` secrets in the deployment environment. Generate each with `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"` and store both secrets in a secrets manager; production startup requires the session secret to be at least 32 bytes and validates the MFA key. Do not commit either value or include them in logs. Keep protected backups; losing the MFA key makes stored TOTP factors unrecoverable and requires operator-assisted re-enrollment.
3. Run `node migrations/050-privileged-totp-mfa.js` against the application database before deploying the MFA-enabled server.
4. Keep both secrets stable across application instances and deployments. Secure session cookies are enabled in production.

## Enrolling an existing privileged account

Existing accounts are not automatically enrolled. An authorized system operator must verify the user's identity in person or through a trusted channel, then issue a one-time code:

1. Run `node scripts/issue-privileged-mfa-enrollment.js <user_id>` from a trusted operator environment connected to the correct database.
2. Deliver the printed code privately to the verified user. It expires in 10 minutes, can be used once, and only its SHA-256 hash is stored. Do not paste it into application logs, tickets, or chat.
3. The user signs in with their password, submits that code, scans the locally generated QR code in an authenticator app, and enters a current six-digit code to activate MFA.
4. The user must save the displayed recovery codes securely. They are shown only once.

The same operator-verified process is required if a user loses their authenticator and all recovery codes. Issuing a new code replaces any in-progress enrollment. Successful replacement invalidates prior recovery codes and other sessions.

## Recovery and audit

Each recovery code is single-use. A successful recovery login rotates the entire recovery-code set; the new codes are shown once. Recovery codes cannot be emailed or retrieved from the database. If both the authenticator and all recovery codes are unavailable, an operator must verify identity and issue a new enrollment code using the procedure above.

The `privileged_mfa_audit` table records enrollment issuance, redemption, success, failures, recovery, and detected expiration events. TOTP secrets and enrollment codes are not written to application logs. Enrollment and verification endpoints are rate-limited; enrollment codes and TOTP verification attempts also have database-backed attempt limits.

Admin and finance sessions are not persistent, regardless of the “stay signed in” selection, and expire after a maximum of 12 hours. Clients retain the existing email OTP and stay-signed-in behavior. Suspending an account revokes its stored sessions and protected page/API requests recheck that the account is active.
