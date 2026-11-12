const { getSessionMaxAge } = require('./sessionSecurity');

const PRIVILEGED_ROLES = new Set(['admin', 'finance_officer']);

function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.has(role);
}

function hasCurrentMfaAssurance(session, user) {
  if (!isPrivilegedRole(user.role) || user.totp_enabled !== true || !user.totp_enrolled_at) {
    return false;
  }
  const authenticatedAt = Number(session.privilegedMfaAuthenticatedAt);
  const sessionAge = Date.now() - authenticatedAt;
  return Number(session.mfaVerifiedAt) === new Date(user.totp_enrolled_at).getTime()
    && Number.isFinite(authenticatedAt)
    && sessionAge >= 0
    && sessionAge < getSessionMaxAge(session)
    && (session.sessionExpiresAt === undefined || Number(session.sessionExpiresAt) > Date.now());
}

module.exports = {
  PRIVILEGED_ROLES,
  isPrivilegedRole,
  hasCurrentMfaAssurance,
};
