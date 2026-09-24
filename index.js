// This is the starting point of the whole backend.
// When you run "node index.js" in the terminal, this is where everything begins.

require('dotenv').config(); // read the .env file before doing anything else

  const express = require('express');
  const session = require('express-session');
  const path = require('path');
  
  const db = require('./db'); // run db.js, so we connect to the database right away
  
  const app = express();
  
  const PORT = process.env.PORT || 3000;
  
  // Needed when deployed behind a proxy such as Render
  app.set('trust proxy', 1);

  app.use(express.json());
  
  // Session setup — this lets the server remember who is logged in
  // between requests, using a cookie stored in the user's browser.
  app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-later',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // session lasts 24 hours
      secure: process.env.NODE_ENV === 'production', // only require HTTPS in production (Render)
    },
  }));
  
  // ============================================
  // Middleware: requireLogin
  // Place this in front of any route that should only be reachable
  // by someone who is currently logged in.
  // ============================================
  function requireLogin(req, res, next) {
    if (!req.session.userId) {
      // If this was a page request (browser navigation), redirect to login
      if (req.accepts('html')) {
        return res.redirect('/LoginPage.html');
      }
      // If this was an API/fetch request, send a JSON error instead
      return res.status(401).json({ message: 'You must be logged in.' });
    }
    next();
  }

  // Role-based page guard. Keep this separate from requireLogin so every
  // protected page must declare which session roles are allowed to open it.
  function requireRole(...allowedRoles) {
    return async (req, res, next) => {
      if (!req.session.userId) return requireLogin(req, res, next);

      try {
        // Refresh the role from the database so an old session cannot retain
        // access after the user's role changes.
        const result = await db.query('SELECT role FROM users WHERE user_id = $1', [req.session.userId]);
        if (result.rows.length === 0) {
          return res.status(401).send('Your session is no longer valid.');
        }

        const currentRole = result.rows[0].role;
        req.session.role = currentRole;

        if (!allowedRoles.includes(currentRole)) {
          return res.status(403).send('You are not authorized to access this page.');
        }

        next();
      } catch (error) {
        console.error('Role authorization error:', error);
        return res.status(500).send('Could not verify your access.');
      }
    };
  }
  
  // Protected pages — each page declares the roles allowed to open it.
  const protectedPages = [
    { path: '/UserAppointment.html', roles: ['client'] },
    { path: '/MyAppointments.html', roles: ['client'] },
    { path: '/UserDashboard.html', roles: ['client'] },
    { path: '/AestheticianAppointmentPage.html', roles: ['aesthetician'] },
    { path: '/AestheticianDashboard.html', roles: ['aesthetician'] },
    { path: '/AdminDashboard.html', roles: ['admin'] },
    { path: '/Usermanagement.html', roles: ['admin'] },
    { path: '/InventoryDashboard.html', roles: ['inventory_officer'] },
    { path: '/FinanceDashboard.html', roles: ['finance_officer'] },
    { path: '/StaffDashboard.html', roles: ['staff'] },
  ];
  
  protectedPages.forEach(({ path: page, roles }) => {
    app.get(page, requireRole(...roles), (req, res) => {
      res.sendFile(path.join(__dirname, page));
    });
  });
  
  // This must come BEFORE express.static — otherwise static file serving
  // auto-shows index.html for "/" before this route ever gets a chance to run.
  app.get('/', (req, res) => {
    if (req.session.userId) {
      // Already logged in — show the homepage
      res.sendFile(__dirname + '/index.html');
    } else {
      // Not logged in — show the login page
      res.sendFile(__dirname + '/LoginPage.html');
    }
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
  // At the end, this tells the server to start listening for incoming
  // requests — this is where everything actually starts running.
