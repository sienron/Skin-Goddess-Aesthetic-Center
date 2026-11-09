const db = require('../db');
const { hasCurrentMfaAssurance, isPrivilegedRole } = require('../utils/privilegedMfa');
const { destroySession } = require('../utils/sessionSecurity');

const MFA_SETUP_PATHS = new Set([
  '/auth/login',
  '/auth/login/verify-otp',
  '/auth/login/resend-otp',
  '/auth/login/verify-totp',
  '/auth/mfa/enrollment/start',
  '/auth/mfa/enrollment/verify',
  '/auth/register',
  '/auth/verify-otp',
  '/auth/resend-otp',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/logout',
]);

async function requirePrivilegedMfa(req, res, next) {
  if (MFA_SETUP_PATHS.has(req.path) || !req.session.userId) return next();

  try {
    const result = await db.query(
      'SELECT role, status, totp_enabled, totp_enrolled_at FROM users WHERE user_id = $1',
      [req.session.userId]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Your session is no longer valid.' });
    }
    if (user.status !== 'active') {
      await destroySession(req, res);
      return res.status(403).json({ message: 'Your account is not active.' });
    }
    if (isPrivilegedRole(user.role) && !hasCurrentMfaAssurance(req.session, user)) {
      await destroySession(req, res);
      return res.status(401).json({ message: 'Your privileged session expired. Sign in again.' });
    }
    req.session.role = user.role;
    return next();
  } catch (error) {
    console.error('Privileged MFA authorization error:', error);
    return res.status(500).json({ message: 'Could not verify privileged MFA.' });
  }
}

module.exports = { requirePrivilegedMfa };
