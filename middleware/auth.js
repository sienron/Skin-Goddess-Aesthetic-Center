// middleware/auth.js
// Pulled out of index.js so any route file (like routes/users.js) can reuse
// the same login/role checks instead of duplicating them. Behavior is
// identical to what was inline in index.js before.

const db = require('../db');

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    if (req.accepts('html')) {
      return res.redirect('/LoginPage.html');
    }
    return res.status(401).json({ message: 'You must be logged in.' });
  }
  next();
}

function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.session.userId) return requireLogin(req, res, next);

    try {
      const result = await db.query('SELECT role FROM users WHERE user_id = $1', [req.session.userId]);
      if (result.rows.length === 0) {
        return res.status(401).json({ message: 'Your session is no longer valid.' });
      }

      const currentRole = result.rows[0].role;
      req.session.role = currentRole;

      if (!allowedRoles.includes(currentRole)) {
        if (req.accepts('html') && !req.path.startsWith('/api/')) {
          return res.status(403).send('You are not authorized to access this page.');
        }
        return res.status(403).json({ message: 'You are not authorized to do this.' });
      }

      next();
    } catch (error) {
      console.error('Role authorization error:', error);
      if (req.accepts('html') && !req.path.startsWith('/api/')) {
        return res.status(500).send('Could not verify your access.');
      }
      return res.status(500).json({ message: 'Could not verify your access.' });
    }
  };
}

module.exports = { requireLogin, requireRole };