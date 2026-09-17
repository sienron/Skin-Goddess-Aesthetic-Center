// This is the starting point of the whole backend.
// When you run "node index.js" in the terminal, this is where everything begins.

require('dotenv').config(); // read the .env file before doing anything else

  const express = require('express');
  const session = require('express-session');
  const path = require('path');
  
  require('./db'); // run db.js, so we connect to the database right away
  
  const app = express();
  
  const PORT = process.env.PORT || 3000;
  
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
  
  // Protected pages — these HTML files require an active session.
  const protectedPages = [
    '/UserAppointment.html',
    '/AestheticianAppointmentPage.html',
    '/UserDashboard.html',
    '/AdminDashboard.html',
    '/AestheticianDashboard.html',
    '/InventoryDashboard.html',
    '/FinanceDashboard.html',
    '/StaffDashboard.html',
  ];
  
  protectedPages.forEach((page) => {
    app.get(page, requireLogin, (req, res) => {
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
  
  app.use(express.static(path.join(__dirname, '')));
  
  app.use('/api/auth', require('./routes/auth'));

  app.use('/api/services', require('./routes/services'));

  app.use('/api/appointments', require('./routes/appointments'));
  
  app.listen(PORT, () => {
    console.log(`Server is running http://localhost:${PORT}`);
  });
  // At the end, this tells the server to start listening for incoming
  // requests — this is where everything actually starts running.