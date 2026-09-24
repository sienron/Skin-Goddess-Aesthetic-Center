require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-later',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production'
  }
}));

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
        'SELECT role FROM users WHERE user_id = $1',
        [req.session.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).send('Your session is no longer valid.');
      }

      const currentRole = result.rows[0].role;
      req.session.role = currentRole;

      if (!allowedRoles.includes(currentRole)) {
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

const protectedPages = [
  { path: '/UserAccount.html', roles: ['client'] },
  { path: '/UserAppointment.html', roles: ['client'] },
  { path: '/MyAppointments.html', roles: ['client'] },
  { path: '/UserDashboard.html', roles: ['client'] },

  { path: '/AestheticianAppointmentPage.html', roles: ['aesthetician'] },
  { path: '/AestheticianDashboard.html', roles: ['aesthetician'] },

  { path: '/AdminDashboard.html', roles: ['admin'] },
  { path: '/Usermanagement.html', roles: ['admin'] },

  { path: '/InventoryDashboard.html', roles: ['inventory_officer'] },
  { path: '/FinanceDashboard.html', roles: ['finance_officer'] },
  { path: '/StaffDashboard.html', roles: ['staff'] }
];

protectedPages.forEach(({ path: page, roles }) => {
  app.get(
    page,
    requireRole(...roles),
    (req, res) => {
      res.sendFile(path.join(__dirname, page));
    }
  );
});

app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }

  res.sendFile(path.join(__dirname, 'LoginPage.html'));
});

app.get('/LoginPage.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }

  res.sendFile(path.join(__dirname, 'LoginPage.html'));
});

app.use(express.static(path.join(__dirname, '')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/inventory', require('./routes/inventory'));

app.listen(PORT, () => {
  console.log(`Server is running http://localhost:${PORT}`);
});