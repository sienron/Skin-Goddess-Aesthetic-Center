const { destroySession, getSessionMaxAge } = require('../utils/sessionSecurity');

async function enforceSessionLifetime(req, res, next) {
  if (!req.session?.userId) return next();

  const now = Date.now();
  const maxAge = getSessionMaxAge(req.session);
  if (req.session.sessionExpiresAt === undefined) {
    // Give older sessions a fixed deadline without extending their existing cookie.
    const authenticatedAt = Number(req.session.privilegedMfaAuthenticatedAt);
    const deadline = Number.isFinite(authenticatedAt) ? authenticatedAt + maxAge : now + maxAge;
    const cookieExpiry = new Date(req.session.cookie.expires).getTime();
    req.session.sessionExpiresAt = Math.min(
      deadline,
      Number.isFinite(cookieExpiry) ? cookieExpiry : deadline,
    );
  }

  const remaining = Number(req.session.sessionExpiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    if (req.path === '/api/auth/login') return next();
    await destroySession(req, res);
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
      return res.redirect('/LoginPage.html');
    }
    return res.status(401).json({ message: 'Your session expired. Sign in again.' });
  }

  req.session.cookie.maxAge = Math.min(remaining, maxAge);
  return next();
}

module.exports = { enforceSessionLifetime };
