function isValidPassword(password) {
  const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
  return typeof password === 'string' && passwordPattern.test(password);
}

module.exports = isValidPassword;