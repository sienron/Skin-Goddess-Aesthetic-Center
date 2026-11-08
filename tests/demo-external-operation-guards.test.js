const test = require('node:test');
const assert = require('node:assert/strict');
const { createBlockDemoCustomerPayments } = require('../utils/demoCustomerAccess');
const { DEMO_CUSTOMER_EMAIL } = require('../utils/demoMode');
const mailer = require('../utils/mailer');

test('demo customer payment middleware blocks access before the PayMongo handler', async () => {
  let nextCalled = false;
  const middleware = createBlockDemoCustomerPayments({
    async query() {
      return { rows: [{ email: DEMO_CUSTOMER_EMAIL, role: 'client' }] };
    }
  });
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await middleware({ session: { userId: 7 } }, response, () => {
    nextCalled = true;
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /payments are unavailable/i);
  assert.equal(nextCalled, false);
});

test('Brevo appointment reminders reject synthetic demo appointments before sending', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('The Brevo endpoint must not be called by this test.');
  };

  try {
    await assert.rejects(
      mailer.sendAppointmentReminderEmail({
        is_demo: true,
        email: 'client@example.test',
        appointment_date: '2026-11-09',
        appointment_time: '09:00:00',
        service_name: 'Demo treatment'
      }, 24),
      /disabled for synthetic demo appointments/
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
});

test('Brevo emails to the shared survey account are rejected before sending', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('The Brevo endpoint must not be called by this test.');
  };

  try {
    await assert.rejects(
      mailer.sendAppointmentReminderEmail({
        email: DEMO_CUSTOMER_EMAIL,
        appointment_date: '2026-11-09',
        appointment_time: '09:00:00',
        service_name: 'Demo treatment'
      }, 24),
      /disabled for the survey account/
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
});
