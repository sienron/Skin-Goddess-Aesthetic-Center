function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 9
    && Buffer.byteLength(password, 'utf8') <= 72
    && /[A-Za-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9\s]/.test(password);
}

isValidPassword.BCRYPT_SALT_ROUNDS = 12;

module.exports = isValidPassword;
