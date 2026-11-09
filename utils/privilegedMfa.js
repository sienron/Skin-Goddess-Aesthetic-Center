const PRIVILEGED_ROLES = new Set(['admin', 'finance_officer']);
const PRIVILEGED_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
    && sessionAge < PRIVILEGED_SESSION_MAX_AGE_MS;
}

module.exports = {
  PRIVILEGED_ROLES,
  PRIVILEGED_SESSION_MAX_AGE_MS,
  isPrivilegedRole,
  hasCurrentMfaAssurance,
};
