function canBookAppointments(user, nodeEnv = process.env.NODE_ENV) {
  return user.email_verified
    && (user.role === 'client' || (nodeEnv !== 'production' && user.dev_access_all === true));
}

module.exports = { canBookAppointments };
