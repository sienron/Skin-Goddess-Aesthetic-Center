function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  return host.trim().replace(/\.$/, '').toLowerCase();
}

function parsePort(port) {
  if (typeof port !== 'string' || !/^\d+$/.test(port)) return null;
  const parsedPort = Number(port);
  return Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : null;
}

function assertDemoDatabaseTargetConfigured(env = process.env) {
  const configuredHost = normalizeHost(env.DB_HOST);
  const expectedHost = normalizeHost(env.DEMO_CUSTOMER_TARGET_HOST);
  const configuredPort = parsePort(env.DB_PORT);
  const expectedPort = parsePort(env.DEMO_CUSTOMER_TARGET_PORT);

  if (!env.DEMO_CUSTOMER_TARGET_DATABASE
    || !configuredHost
    || !expectedHost
    || configuredHost !== expectedHost
    || configuredPort === null
    || configuredPort !== expectedPort) {
    throw new Error('Demo database target is incomplete or does not match DB_HOST, DB_PORT, and DEMO_CUSTOMER_TARGET_DATABASE.');
  }

  return {
    database: env.DEMO_CUSTOMER_TARGET_DATABASE,
    host: expectedHost,
    port: expectedPort,
  };
}

async function assertConnectedDemoDatabaseTarget(client, env = process.env) {
  const expected = assertDemoDatabaseTargetConfigured(env);
  const result = await client.query('SELECT current_database() AS database_name');

  if (result.rows[0]?.database_name !== expected.database) {
    throw new Error('Connected PostgreSQL endpoint does not match the explicitly approved demo target.');
  }
}

module.exports = {
  assertConnectedDemoDatabaseTarget,
  assertDemoDatabaseTargetConfigured,
};
