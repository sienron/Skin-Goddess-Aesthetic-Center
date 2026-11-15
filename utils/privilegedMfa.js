const { getSessionMaxAge } = require('./sessionSecurity');
const { STAFF_ROLES } = require('./roleRoutes');

const STAFF_MFA_ROLES = new Set(STAFF_ROLES);

function requiresStaffMfa(role) {
  return STAFF_MFA_ROLES.has(role);
}

function hasCurrentMfaAssurance(session, user) {
  if (!requiresStaffMfa(user.role) || user.totp_enabled !== true || !user.totp_enrolled_at) {
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
  STAFF_MFA_ROLES,
  requiresStaffMfa,
  isPrivilegedRole: requiresStaffMfa,
  hasCurrentMfaAssurance,
};
