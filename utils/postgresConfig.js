function getPostgresSslConfig(env = process.env) {
  if (env.NODE_ENV === 'production' || env.DB_SSL === 'true') {
    return { rejectUnauthorized: true };
  }

  return false;
}

module.exports = { getPostgresSslConfig };
