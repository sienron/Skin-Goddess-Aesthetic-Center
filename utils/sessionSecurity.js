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

module.exports = { destroySession };
