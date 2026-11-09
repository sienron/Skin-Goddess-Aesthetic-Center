const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('crypto');
const db = require('../db');
const notifications = require('../utils/notifications');
const {
  PAYMONGO_WEBHOOK_TOLERANCE_SECONDS,
  verifyPayMongoWebhookSignature,
} = require('../utils/paymongoWebhookSecurity');

const webhookSecret = 'whsk_test_webhook_regression';
const signatureConfig = { webhookSecret, isLive: false };

function signBody(timestamp, rawBody) {
  const signature = createHmac('sha256', webhookSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest('hex');
  return `t=${timestamp},te=${signature}`;
}

test('PayMongo webhook signature accepts a fresh signature over exact raw bytes', () => {
  const timestamp = 1_800_000_000;
  const rawBody = Buffer.from([0x7b, 0x22, 0xff, 0x7d]);

  assert.equal(
    verifyPayMongoWebhookSignature(signBody(timestamp, rawBody), rawBody, signatureConfig, timestamp),
    true,
  );
});

test('PayMongo webhook signature rejects expired and future-dated timestamps', () => {
  const now = 1_800_000_000;
  const rawBody = Buffer.from('{"data":{}}');
  const allowedPast = now - PAYMONGO_WEBHOOK_TOLERANCE_SECONDS;
  const allowedFuture = now + PAYMONGO_WEBHOOK_TOLERANCE_SECONDS;
  const outsidePast = allowedPast - 1;
  const outsideFuture = allowedFuture + 1;

  assert.equal(
    verifyPayMongoWebhookSignature(signBody(allowedPast, rawBody), rawBody, signatureConfig, now),
    true,
  );
  assert.equal(
    verifyPayMongoWebhookSignature(signBody(allowedFuture, rawBody), rawBody, signatureConfig, now),
    true,
  );
  assert.equal(
    verifyPayMongoWebhookSignature(signBody(outsidePast, rawBody), rawBody, signatureConfig, now),
    false,
  );
  assert.equal(
    verifyPayMongoWebhookSignature(signBody(outsideFuture, rawBody), rawBody, signatureConfig, now),
    false,
  );
});

test('PayMongo webhook signature rejects malformed headers and invalid signatures', () => {
  const timestamp = 1_800_000_000;
  const rawBody = Buffer.from('{"data":{}}');

  for (const header of [
    undefined,
    '',
    'te=missing-timestamp',
    `t=not-a-time,te=${'a'.repeat(64)}`,
    `t=${timestamp},te=not-a-signature`,
    `t=${timestamp},t=${timestamp},te=${'a'.repeat(64)}`,
    `t=${timestamp},unknown=value,te=${'a'.repeat(64)}`,
  ]) {
    assert.equal(verifyPayMongoWebhookSignature(header, rawBody, signatureConfig, timestamp), false);
  }

  const validHeader = signBody(timestamp, rawBody);
  assert.equal(
    verifyPayMongoWebhookSignature(validHeader, Buffer.from('{"data":{"changed":true}}'), signatureConfig, timestamp),
    false,
  );
});

test('PayMongo webhook retries within timestamp tolerance remain idempotent', async () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PAYMONGO_TEST_SECRET_KEY: process.env.PAYMONGO_TEST_SECRET_KEY,
    PAYMONGO_TEST_WEBHOOK_SECRET: process.env.PAYMONGO_TEST_WEBHOOK_SECRET,
  };
  const originalTransaction = db.transaction;
  const originalNotifyUser = notifications.notifyUser;
  const originalNotifyRoles = notifications.notifyRoles;
  const referenceNumber = `SG${'B'.repeat(24)}`;
  const checkoutSessionId = 'cs_test_webhook_retry';
  const timestamp = Math.floor(Date.now() / 1000);
  let checkoutStatus = 'pending';
  let appointmentInsertCount = 0;
  let statusCode = 200;

  process.env.NODE_ENV = 'development';
  process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_webhook_security';
  process.env.PAYMONGO_TEST_WEBHOOK_SECRET = webhookSecret;
  notifications.notifyUser = async () => {};
  notifications.notifyRoles = async () => {};

  const event = {
    data: {
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        data: {
          id: checkoutSessionId,
          attributes: {
            reference_number: referenceNumber,
            line_items: [{ amount: 1000, quantity: 1 }],
            payments: [{
              id: 'pay_test_webhook_retry',
              attributes: {
                status: 'paid',
                amount: 1000,
                currency: 'PHP',
                source: { type: 'gcash' },
              },
            }],
          },
        },
      },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signatureHeader = signBody(timestamp, rawBody);

  db.transaction = async (callback) => callback({
    async query(sql) {
      if (/SELECT reference_number, user_id/.test(sql)) {
        return {
          rows: [{
            reference_number: referenceNumber,
            user_id: 7,
            service_id: 3,
            service_name: 'Test service',
            service_price: '100.00',
            appointment_date: '2099-01-01',
            appointment_time: '10:00:00',
            appointment_end_time: '11:30:00',
            booked_duration_minutes: 60,
            booked_buffer_minutes: 30,
            amount_cents: 1000,
            status: checkoutStatus,
            appointment_id: checkoutStatus === 'consumed' ? 42 : null,
            payment_method: null,
          }],
        };
      }
      if (/SELECT user_id FROM users/.test(sql)) return { rows: [{ user_id: 8 }] };
      if (/SELECT u\.user_id, u\.first_name/.test(sql)) {
        return { rows: [{ user_id: 8, first_name: 'Staff', last_name: 'Member', role: 'aesthetician' }] };
      }
      if (/INSERT INTO appointments/.test(sql)) {
        appointmentInsertCount += 1;
        return {
          rows: [{
            appointment_id: 42,
            appointment_status: 'confirmed',
            payment_status: 'paid',
            aesthetician_id: 8,
          }],
        };
      }
      if (/UPDATE paymongo_checkout_sessions/.test(sql) && /status = 'consumed'/.test(sql)) {
        checkoutStatus = 'consumed';
      }
      return { rows: [] };
    },
  });

  try {
    const router = require('../routes/appointments');
    const webhookRoute = router.stack
      .find((layer) => layer.route?.path === '/paymongo/webhook' && layer.route.methods.post)
      .route.stack.at(-1).handle;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      statusCode = 200;
      await webhookRoute({
        body: rawBody,
        get: () => signatureHeader,
      }, {
        status(code) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
        sendStatus(code) {
          statusCode = code;
          return this;
        },
      });
      assert.equal(statusCode, 200);
    }

    assert.equal(appointmentInsertCount, 1);
    assert.equal(checkoutStatus, 'consumed');
  } finally {
    db.transaction = originalTransaction;
    notifications.notifyUser = originalNotifyUser;
    notifications.notifyRoles = originalNotifyRoles;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
