const helmet = require('helmet');

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  frameSrc: ["'self'", 'https://checkout.paymongo.com', 'https://www.google.com'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  objectSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
    'https://cdn.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
  ],
};

function createSecurityHeaders({ production = process.env.NODE_ENV === 'production' } = {}) {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      directives: {
        ...CONTENT_SECURITY_POLICY,
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    frameguard: { action: 'deny' },
    hsts: false,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  return (req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(self)');
    if (production && req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return helmetMiddleware(req, res, next);
  };
}

module.exports = { createSecurityHeaders };
