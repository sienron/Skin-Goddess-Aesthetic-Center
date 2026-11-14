const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const db = require('../db');
const mailer = require('../utils/mailer');

const originalQuery = db.query;
const originalSendInquiryNotification = mailer.sendInquiryNotification;
mailer.sendInquiryNotification = async () => {};
const inquiriesRouter = require('../routes/inquiries');

async function withServer(callback) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/inquiries', inquiriesRouter);
  app.get('/health-check', (req, res) => res.sendStatus(200));
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

async function withClientServer(callback) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: 42 };
    next();
  });
  app.use('/api/inquiries', inquiriesRouter);
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

function submitInquiry(port) {
  return fetch(`http://127.0.0.1:${port}/api/inquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Jamie',
      lastName: "O'Neil",
      email: 'jamie@example.com',
      phone: '',
      subject: 'services',
      message: 'I would like to know more about your services.',
    }),
  });
}

test('legitimate inquiry submissions succeed while excess submissions from one IP get 429', async () => {
  let savedInquiries = 0;
  const rateLimitHits = new Map();
  db.query = async (sql, values) => {
    if (sql.includes('INSERT INTO rate_limit_counters')) {
      const key = `${values[0]}:${values[1]}`;
      const totalHits = (rateLimitHits.get(key) || 0) + 1;
      rateLimitHits.set(key, totalHits);
      return {
        rows: [{ total_hits: totalHits, reset_at: new Date(Date.now() + 15 * 60 * 1000) }],
      };
    }

    if (sql.includes('WITH expired AS')) {
      return { rows: [] };
    }

    assert.match(sql, /INSERT INTO inquiries/);
    assert.deepEqual(values, [
      'Jamie',
      "O'Neil",
      'jamie@example.com',
      null,
      'services',
      'I would like to know more about your services.',
    ]);
    savedInquiries += 1;
    return { rows: [{ inquiry_id: savedInquiries }] };
  };

  try {
    await withServer(async (port) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await submitInquiry(port);
        assert.equal(response.status, 201);
        assert.equal((await response.json()).message, 'Your inquiry has been sent.');
      }

      const limitedResponse = await submitInquiry(port);
      assert.equal(limitedResponse.status, 429);
      const limitedBody = await limitedResponse.json();
      assert.deepEqual(limitedBody, {
        message: 'Too many inquiry submissions. Please try again later.',
      });
      assert.doesNotMatch(JSON.stringify(limitedBody), /database|rate.?limit|stack/i);
      assert.equal(savedInquiries, 5);

      const unrelatedResponse = await fetch(`http://127.0.0.1:${port}/health-check`);
      assert.equal(unrelatedResponse.status, 200);
    });
  } finally {
    db.query = originalQuery;
  }
});

test('customers can view only their own inquiry tickets', async () => {
  let currentRole = 'client';
  let ticketQueryCalls = 0;
  db.query = async (sql, values) => {
    if (/SELECT role, status, dev_access_all/.test(sql)) {
      assert.deepEqual(values, [42]);
      return {
        rows: [{
          role: currentRole,
          status: 'active',
          dev_access_all: false,
          totp_enabled: false,
          totp_enrolled_at: null,
        }],
      };
    }

    ticketQueryCalls += 1;
    assert.match(sql, /FROM inquiries i/);
    assert.match(sql, /LOWER\(i\.email\) = LOWER\(u\.email\)/);
    assert.deepEqual(values, [42]);
    return {
      rows: [{
        inquiry_id: 17,
        inquiry_type: 'booking',
        message: 'Please confirm my appointment.',
        admin_reply: 'Your booking is confirmed.',
        replied_at: '2026-11-12T10:00:00.000Z',
        created_at: '2026-11-11T10:00:00.000Z',
      }],
    };
  };

  try {
    await withClientServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/inquiries/mine`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [{
        inquiry_id: 17,
        inquiry_type: 'booking',
        message: 'Please confirm my appointment.',
        admin_reply: 'Your booking is confirmed.',
        replied_at: '2026-11-12T10:00:00.000Z',
        created_at: '2026-11-11T10:00:00.000Z',
      }]);
      assert.equal(ticketQueryCalls, 1);

      currentRole = 'aesthetician';
      const forbidden = await fetch(`http://127.0.0.1:${port}/api/inquiries/mine`);
      assert.equal(forbidden.status, 403);
      assert.equal(ticketQueryCalls, 1);
    });
  } finally {
    db.query = originalQuery;
  }
});

test.after(() => {
  db.query = originalQuery;
  mailer.sendInquiryNotification = originalSendInquiryNotification;
});
