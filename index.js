require('dotenv').config();
require('./utils/runtimeSecurityConfig').assertValidRuntimeSecurityConfig();
if (process.env.NODE_ENV === 'production') {
  require('./utils/totp').validateEncryptionKey();
}
require('./utils/demoMode').assertValidDemoCustomerConfiguration();

const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { DASHBOARD_PER_ROLE } = require('./utils/roleRoutes');
const { hasRoleAccess } = require('./utils/roleAccess');
const {
  hasCurrentMfaAssurance,
  isPrivilegedRole,
  PRIVILEGED_SESSION_MAX_AGE_MS,
} = require('./utils/privilegedMfa');
const { requirePrivilegedMfa } = require('./middleware/privilegedMfa');
const { createSecurityHeaders } = require('./middleware/securityHeaders');
const { destroySession } = require('./utils/sessionSecurity');
const PgSession = require('connect-pg-simple')(session);

const db = require('./db');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const sessionSecret = process.env.SESSION_SECRET;
const STAY_SIGNED_IN_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

app.set('trust proxy', 1);
app.use(createSecurityHeaders());

app.use('/api/appointments/paymongo/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '8mb' }));

app.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  if (req.session?.staySignedIn && !req.session.privilegedMfaAuthenticatedAt) {
    req.session.cookie.maxAge = STAY_SIGNED_IN_MAX_AGE;
  }

  if (req.session?.privilegedMfaAuthenticatedAt) {
    const authenticatedAt = Number(req.session.privilegedMfaAuthenticatedAt);
    const remaining = PRIVILEGED_SESSION_MAX_AGE_MS
      - (Date.now() - authenticatedAt);
    if (!Number.isFinite(authenticatedAt) || remaining <= 0) {
      if (req.path === '/api/auth/login') return next();
      return destroySession(req, res).then(() => {
        if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
          return res.redirect('/LoginPage.html?mfa=required');
        }
        return res.status(401).json({ message: 'Your privileged session expired. Sign in again.' });
      });
    }
    req.session.cookie.maxAge = Math.min(
      Number(req.session.cookie.maxAge) || PRIVILEGED_SESSION_MAX_AGE_MS,
      remaining,
    );
  }
  next();
});

app.use('/api', requirePrivilegedMfa);

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    || req.path === '/api/appointments/paymongo/webhook') return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  if (!origin && !referer) {
    return res.status(403).json({ message: 'Request origin could not be verified.' });
  }

  try {
    const sourceOrigin = new URL(origin || referer).origin;
    const expectedOrigin = `${req.protocol}://${req.get('host')}`;
    if (sourceOrigin !== expectedOrigin) {
      return res.status(403).json({ message: 'Cross-site request rejected.' });
    }
  } catch (error) {
    return res.status(403).json({ message: 'Request origin could not be verified.' });
  }

  return next();
});

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    if (req.accepts('html')) {
      return res.redirect('/LoginPage.html');
    }

    return res.status(401).json({
      message: 'You must be logged in.'
    });
  }

  next();
}

function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.session.userId) {
      return requireLogin(req, res, next);
    }

    try {
      const result = await db.query(
        'SELECT role, status, dev_access_all, totp_enabled, totp_enrolled_at FROM users WHERE user_id = $1',
        [req.session.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).send('Your session is no longer valid.');
      }

      if (result.rows[0].status !== 'active') {
        return res.status(403).send('Your account is not active.');
      }

      const currentRole = result.rows[0].role;
      req.session.role = currentRole;
      if (isPrivilegedRole(currentRole) && !hasCurrentMfaAssurance(req.session, result.rows[0])) {
        return res.status(403).send('Complete privileged MFA before accessing this page.');
      }
      const localDevAccess = process.env.NODE_ENV === 'development'
        && result.rows[0].dev_access_all === true;

      if (!hasRoleAccess(currentRole, allowedRoles, localDevAccess)) {
        return res.status(403).send(
          'You are not authorized to access this page.'
        );
      }

      next();
    } catch (error) {
      console.error('Role authorization error:', error);
      return res.status(500).send(
        'Could not verify your access.'
      );
    }
  };
}

const INVENTORY_OFFICER_PAGES = new Set([
  '/InventoryManagement.html',
  '/InventoryTransactions.html',
]);

app.use(async (req, res, next) => {
  const requestedPage = req.path;
  if (!req.session.userId
    || (requestedPage !== '/' && path.extname(requestedPage).toLowerCase() !== '.html')) {
    return next();
  }

  try {
    const result = await db.query(
      'SELECT role, status, dev_access_all, totp_enabled, totp_enrolled_at FROM users WHERE user_id = $1',
      [req.session.userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).send('Your session is no longer valid.');
    }

    if (user.status !== 'active') {
      return destroySession(req, res).then(() => (
        res.status(403).send('Your account is not active.')
      ));
    }

    if (requestedPage !== '/LoginPage.html'
      && isPrivilegedRole(user.role)
      && !hasCurrentMfaAssurance(req.session, user)) {
      return destroySession(req, res)
        .then(() => res.redirect('/LoginPage.html?mfa=required'));
    }

    req.session.role = user.role;
    if (requestedPage === '/' || (requestedPage === '/index.html' && user.role !== 'admin')) {
      const dashboardPath = DASHBOARD_PER_ROLE[user.role];
      if (!dashboardPath) {
        return res.status(403).send('Your account role does not have an assigned destination.');
      }
      if (requestedPage !== dashboardPath) {
        return res.redirect(dashboardPath);
      }
    }

    const localDevAccess = process.env.NODE_ENV === 'development' && user.dev_access_all === true;
    if (user.role === 'inventory_officer' && !localDevAccess) {
      if (requestedPage === '/' || !INVENTORY_OFFICER_PAGES.has(requestedPage)) {
        return res.redirect('/InventoryManagement.html');
      }
    }

    return next();
  } catch (error) {
    console.error('Page access authorization error:', error);
    return res.status(500).send('Could not verify your access.');
  }
});

const protectedPages = [
  { path: '/UserAccount.html', roles: ['client', 'admin', 'aesthetician', 'inventory_officer', 'finance_officer', 'staff'] },
  { path: '/UserAppointment.html', roles: ['client'] },
  { path: '/MyAppointments.html', roles: ['client'] },
  { path: '/UserDashboard.html', roles: ['client'] },

  { path: '/AestheticianAppointmentPage.html', roles: ['aesthetician', 'staff'] },
  { path: '/StaffAppointmentPage.html', roles: ['aesthetician', 'staff'] },
  { path: '/StaffDashboard.html', roles: ['aesthetician', 'staff'] },
  { path: '/StaffTreatmentHistory.html', roles: ['aesthetician', 'staff'] },
  { path: '/StaffTreatmentNotes.html', roles: ['aesthetician', 'staff'] },
  { path: '/StaffUserManagement.html', roles: ['aesthetician', 'staff'] },

  { path: '/AdminDashboard.html', roles: ['admin'] },
  { path: '/AdminAppointment.html', roles: ['admin'] },
  { path: '/AdminClients.html', roles: ['admin'] },
  { path: '/AdminTreatmentHistory.html', roles: ['admin'] },
  { path: '/AdminContentManagement.html', roles: ['admin'] },
  { path: '/ClinicManagement.html', roles: ['admin'] },
  { path: '/AdminInquiries.html', roles: ['admin'] },
  { path: '/AdminInventoryManagement.html', roles: ['admin'] },
  { path: '/Usermanagement.html', roles: ['admin'] },

  { path: '/InventoryManagement.html', roles: ['inventory_officer'] },
  { path: '/InventoryTransactions.html', roles: ['inventory_officer', 'admin'] },
  { path: '/FinanceDashboard.html', roles: ['finance_officer', 'admin'] },
  { path: '/FinanceExpenses.html', roles: ['finance_officer', 'admin'] },
  { path: '/FinanceReports.html', roles: ['finance_officer', 'admin'] },
  { path: '/FinancesTransactions.html', roles: ['finance_officer', 'admin'] }
];

protectedPages.forEach(({ path: page, roles }) => {
  app.get(
    page,
    requireRole(...roles),
    (req, res) => {
      res.sendFile(path.join(publicDir, page));
    }
  );
});

app.get('/AdminInventoryTransactions.html', requireRole('admin'), (req, res) => {
  res.sendFile(path.join(publicDir, 'AdminInventoryTransactions.html'));
});

app.get('/InventoryDashboard.html', requireRole('inventory_officer'), (req, res) => {
  res.redirect('/InventoryManagement.html');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'LoginPage.html'));
});

app.get('/LoginPage.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }

  res.sendFile(path.join(publicDir, 'LoginPage.html'));
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/services', require('./routes/services'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/newsletter', require('./routes/newsletter'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/content', require('./routes/content'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/clinic', require('./routes/clinic'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/users', require('./routes/users'));
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api/finance', require('./routes/finance'));

// Static assets are not content-hashed, so they are cacheable but never `immutable`.
const STATIC_CACHE_CONTROL = {
  images: 'public, max-age=86400, stale-while-revalidate=604800',
  fonts: 'public, max-age=2592000',
  icons: 'public, max-age=604800',
};
const IMMUTABLE_HASHED_FILE = /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;

app.use(compression());
app.use(express.static(publicDir, {
  dotfiles: 'deny',
  index: false,
  setHeaders(res, filePath) {
    const relative = path.relative(publicDir, filePath).split(path.sep);
    const policy = STATIC_CACHE_CONTROL[relative[0]];
    if (!policy) return;
    res.setHeader(
      'Cache-Control',
      IMMUTABLE_HASHED_FILE.test(filePath) ? 'public, max-age=31536000, immutable' : policy,
    );
  },
}));

require('./utils/notificationJobs').startNotificationJobs();

const server = app.listen(PORT, () => {
  console.log(`Server is running http://localhost:${PORT}`);
});

const { terminateWorker } = require('./utils/invoiceOcr');
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.once(signal, () => {
    server.close(() => {
      terminateWorker()
        .then(() => db.pool.end())
        .then(() => process.exit(0))
        .catch(error => {
          console.error('Failed to stop the server cleanly:', error);
          process.exit(1);
        });
    });
  });
});
