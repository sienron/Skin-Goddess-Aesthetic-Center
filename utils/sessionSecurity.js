const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAY_SIGNED_IN_MAX_AGE_MS = 30 * DEFAULT_SESSION_MAX_AGE_MS;
const CLIENT_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STAFF_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function getSessionIdleTimeout(session) {
  return session.role && session.role !== 'client'
    ? STAFF_IDLE_TIMEOUT_MS
    : CLIENT_IDLE_TIMEOUT_MS;
}

function getSessionMaxAge(session) {
  return session.staySignedIn === true
    ? STAY_SIGNED_IN_MAX_AGE_MS
    : DEFAULT_SESSION_MAX_AGE_MS;
}

function destroySession(req, res) {
  return new Promise((resolve) => {
    if (!req.session) {
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      resolve();
      return;
    }

    req.session.destroy((error) => {
      if (error) console.error('Could not destroy an expired or revoked session:', error);
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      resolve();
    });
  });
}

module.exports = {
  DEFAULT_SESSION_MAX_AGE_MS,
  STAY_SIGNED_IN_MAX_AGE_MS,
  CLIENT_IDLE_TIMEOUT_MS,
  STAFF_IDLE_TIMEOUT_MS,
  getSessionMaxAge,
  getSessionIdleTimeout,
  destroySession,
};
