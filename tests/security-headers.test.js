const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createSecurityHeaders } = require('../middleware/securityHeaders');

async function withServer(production, callback) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createSecurityHeaders({ production }));
  app.get('/', (req, res) => res.send('ok'));
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function getHeaders(port, forwardedProtocol) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/',
      headers: forwardedProtocol ? { 'x-forwarded-proto': forwardedProtocol } : {},
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.headers));
    });
    request.on('error', reject);
  });
}

test('security headers include a compatible CSP and defensive browser policies', async () => {
  await withServer(false, async (port) => {
    const headers = await getHeaders(port);
    const csp = headers['content-security-policy'];

    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src[^;]*'unsafe-inline'[^;]*cdn\.jsdelivr\.net/);
    assert.match(csp, /style-src[^;]*fonts\.googleapis\.com/);
    assert.match(csp, /frame-src[^;]*checkout\.paymongo\.com/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.match(headers['permissions-policy'], /camera=\(\)/);
    assert.match(headers['permissions-policy'], /microphone=\(\)/);
    assert.equal(headers['strict-transport-security'], undefined);
  });
});

test('HSTS is enabled only for production requests recognized as HTTPS', async () => {
  await withServer(true, async (port) => {
    const httpHeaders = await getHeaders(port);
    const httpsHeaders = await getHeaders(port, 'https');

    assert.equal(httpHeaders['strict-transport-security'], undefined);
    assert.match(httpsHeaders['strict-transport-security'], /max-age=31536000/);
    assert.match(httpsHeaders['strict-transport-security'], /includeSubDomains/);
    assert.match(httpsHeaders['content-security-policy'], /upgrade-insecure-requests/);
  });
});
