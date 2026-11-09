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
  db.query = async (sql, values) => {
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

test.after(() => {
  db.query = originalQuery;
  mailer.sendInquiryNotification = originalSendInquiryNotification;
});
