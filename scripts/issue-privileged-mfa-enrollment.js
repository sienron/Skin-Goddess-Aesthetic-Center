const db = require('../db');
const { isPrivilegedRole } = require('../utils/privilegedMfa');
const {
  createEnrollmentCode,
  hashEnrollmentCode,
  validateEncryptionKey,
} = require('../utils/totp');

async function issueEnrollmentCode(userId) {
  validateEncryptionKey();
  const code = createEnrollmentCode();
  await db.transaction(async (client) => {
    const result = await client.query(
      'SELECT user_id, role, status FROM users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const user = result.rows[0];
    if (!user || !isPrivilegedRole(user.role) || user.status !== 'active') {
      throw new Error('Target must be an active admin or finance account.');
    }

    const expired = await client.query(`
      UPDATE privileged_mfa_enrollment_codes
      SET expired_at = expires_at
      WHERE user_id = $1 AND used_at IS NULL AND expired_at IS NULL
        AND revoked_at IS NULL AND expires_at <= NOW()
      RETURNING enrollment_code_id
    `, [userId]);
    for (const row of expired.rows) {
      await client.query(
        `INSERT INTO privileged_mfa_audit (user_id, event_type)
         VALUES ($1, 'enrollment_code_expired')`,
        [userId]
      );
    }

    await client.query(`
      UPDATE privileged_mfa_enrollment_codes
      SET revoked_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL AND expired_at IS NULL
        AND revoked_at IS NULL AND expires_at > NOW()
    `, [userId]);
    await client.query('DELETE FROM privileged_mfa_pending_enrollments WHERE user_id = $1', [userId]);
    await client.query(`
      INSERT INTO privileged_mfa_enrollment_codes (user_id, code_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
    `, [userId, hashEnrollmentCode(code)]);
    await client.query(
      `INSERT INTO privileged_mfa_audit (user_id, event_type)
       VALUES ($1, 'enrollment_code_issued')`,
      [userId]
    );
  });
  return code;
}

async function main() {
  const rawUserId = process.argv[2];
  if (!/^\d+$/.test(rawUserId || '') || !Number.isSafeInteger(Number(rawUserId)) || Number(rawUserId) < 1) {
    throw new Error('Usage: node scripts/issue-privileged-mfa-enrollment.js <user_id>');
  }
  const code = await issueEnrollmentCode(Number(rawUserId));
  process.stdout.write(`${code}\n`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { issueEnrollmentCode };
