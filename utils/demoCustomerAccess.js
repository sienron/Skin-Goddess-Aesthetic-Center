const { isDemoCustomerAccount } = require('./demoMode');

function createPreserveDemoCustomerAccess(database) {
  return async function preserveDemoCustomerAccess(req, res, next) {
    if (!req.session.userId) return next();

    try {
      const result = await database.query(`
        SELECT email, role, mfa_enabled
        FROM users
        WHERE user_id = $1
      `, [req.session.userId]);
      const user = result.rows[0];
      if (isDemoCustomerAccount(user)) {
        return res.status(403).json({
          message: 'This shared survey account cannot change its profile or sign-in credentials.',
        });
      }
      return next();
    } catch (error) {
      console.error('Demo account protection check failed:', error);
      return res.status(500).json({ message: 'Could not verify account access.' });
    }
  };
}

function createBlockDemoCustomerPayments(database) {
  return async function blockDemoCustomerPayments(req, res, next) {
    if (!req.session.userId) {
      return res.status(401).json({ message: 'You must be logged in.' });
    }

    try {
      const result = await database.query(
        'SELECT email, role FROM users WHERE user_id = $1',
        [req.session.userId],
      );
      if (!result.rows.length) {
        return res.status(401).json({ message: 'Your session is no longer valid.' });
      }
      if (isDemoCustomerAccount(result.rows[0])) {
        return res.status(403).json({ message: 'Payments are unavailable for the survey account.' });
      }
      return next();
    } catch (error) {
      console.error('Demo payment restriction check failed:', error);
      return res.status(500).json({ message: 'Could not verify payment access.' });
    }
  };
}

module.exports = { createBlockDemoCustomerPayments, createPreserveDemoCustomerAccess };
