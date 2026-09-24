// This is the starting point of the whole backend.
// When you run "node index.js" in the terminal, this is where everything begins.

require('dotenv').config(); // read the .env file before doing anything else

  const express = require('express');
  const session = require('express-session');
  const path = require('path');
  
  const db = require('./db'); // run db.js, so we connect to the database right away
  const { requireLogin, requireRole } = require('./middleware/auth'); // login/role checks, shared with routes/users.js
  
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
  
  // Protected pages — each page declares the roles allowed to open it.
  const protectedPages = [
    { path: '/UserAppointment.html', roles: ['client'] },
    { path: '/MyAppointments.html', roles: ['client'] },
    { path: '/UserDashboard.html', roles: ['client'] },
    { path: '/AestheticianAppointmentPage.html', roles: ['aesthetician', 'admin'] },
    { path: '/AestheticianDashboard.html', roles: ['aesthetician', 'admin'] },
    { path: '/AestheticianUserManagement.html', roles: ['aesthetician', 'admin'] },
    { path: '/AestheticianTreatmentNotes.html', roles: ['aesthetician', 'admin'] },
    { path: '/AdminDashboard.html', roles: ['admin'] },
    { path: '/Usermanagement.html', roles: ['admin'] },
    { path: '/InventoryDashboard.html', roles: ['inventory_officer'] },
    { path: '/FinanceDashboard.html', roles: ['finance_officer', 'admin'] },
    { path: '/FinancesTransactions.html', roles: ['finance_officer', 'admin'] },
    { path: '/FinanceExpenses.html', roles: ['finance_officer', 'admin'] },
    { path: '/FinanceReports.html', roles: ['finance_officer', 'admin'] },
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

  app.use('/api/users', require('./routes/users'));

  // Every finance API endpoint inherits the finance/admin role check.
  app.use('/api/finance', require('./routes/finance'));
  
  app.listen(PORT, () => {
    console.log(`Server is running http://localhost:${PORT}`);
  });
  // At the end, this tells the server to start listening for incoming
  // requests — this is where everything actually starts running.