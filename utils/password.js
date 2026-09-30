function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && Buffer.byteLength(password, 'utf8') <= 72
    && /[^A-Za-z0-9\s]/.test(password);
}

module.exports = isValidPassword;