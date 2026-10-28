function hasRoleAccess(role, allowedRoles, localDevAccess = false) {
  return allowedRoles.includes(role) || localDevAccess;
}

module.exports = { hasRoleAccess };
