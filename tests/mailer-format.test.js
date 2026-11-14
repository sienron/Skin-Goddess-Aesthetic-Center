const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../utils/mailer');

const originalFetch = global.fetch;
const originalBrevoApiKey = process.env.BREVO_API_KEY;
const originalEmailUser = process.env.EMAIL_USER;
const originalInquiryEmail = process.env.INQUIRY_NOTIFICATION_EMAIL;

test('all mailer features use the same branded HTML and plain-text email layout', async () => {
  const messages = [];
  process.env.BREVO_API_KEY = 'test-key';
  process.env.EMAIL_USER = 'clinic@example.com';
  process.env.INQUIRY_NOTIFICATION_EMAIL = 'inquiries@example.com';
  global.fetch = async (_url, options) => {
    messages.push(JSON.parse(options.body));
    return { ok: true, text: async () => '' };
  };

  try {
    await mailer.sendOtpEmail('client@example.com', '123456');
    await mailer.sendPasswordResetEmail('client@example.com', 'https://example.com/reset?token=abc');
    await mailer.sendAppointmentReminderEmail({
      email: 'client@example.com',
      first_name: 'Jamie',
      service_name: 'Hydrating Facial',
      appointment_date: '2026-11-20',
      appointment_time: '10:30',
    }, 24);
    await mailer.sendInquiryReply('client@example.com', 'Jamie', 'Thanks for your message.\nWe can help.');
    await mailer.sendInquiryNotification({
      firstName: 'Jamie',
      lastName: 'Client',
      email: 'client@example.com',
      phone: '+63 900 000 0000',
      subject: 'Appointment question',
      message: 'Please help with my booking.',
    });
    await mailer.sendNotificationEmail('client@example.com', 'appointment_confirmed', 'Your appointment is confirmed.');
  } finally {
    global.fetch = originalFetch;
    if (originalBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoApiKey;
    if (originalEmailUser === undefined) delete process.env.EMAIL_USER;
    else process.env.EMAIL_USER = originalEmailUser;
    if (originalInquiryEmail === undefined) delete process.env.INQUIRY_NOTIFICATION_EMAIL;
    else process.env.INQUIRY_NOTIFICATION_EMAIL = originalInquiryEmail;
  }

  assert.equal(messages.length, 6);
  for (const message of messages) {
    assert.match(message.htmlContent, /<!doctype html>/i);
    assert.match(message.htmlContent, /Skin Goddess Aesthetic Center/);
    assert.match(message.htmlContent, /info@skingoddess\.ph/);
    assert.match(message.textContent, /Skin Goddess Aesthetic Center/);
    assert.match(message.textContent, /info@skingoddess\.ph/);
  }
  assert.match(messages[0].htmlContent, /Your secure email verification code is ready/);
  assert.match(messages[1].htmlContent, /Reset password/);
  assert.match(messages[2].htmlContent, /Hydrating Facial/);
  assert.match(messages[3].htmlContent, /Thanks for your message\.<br>We can help\./);
  assert.match(messages[4].htmlContent, /New customer inquiry/);
  assert.match(messages[5].htmlContent, /Appointment Confirmed/);
});

test('customer-provided email text is escaped in HTML while preserved in text email', async () => {
  const originalFetchForTest = global.fetch;
  let message;
  global.fetch = async (_url, options) => {
    message = JSON.parse(options.body);
    return { ok: true, text: async () => '' };
  };

  try {
    await mailer.sendInquiryReply('client@example.com', '<Jamie>', '<script>alert(1)</script>');
  } finally {
    global.fetch = originalFetchForTest;
  }

  assert.doesNotMatch(message.htmlContent, /<script>/);
  assert.match(message.htmlContent, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(message.textContent, /<script>alert\(1\)<\/script>/);
});

test.after(() => {
  global.fetch = originalFetch;
  if (originalBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = originalBrevoApiKey;
  if (originalEmailUser === undefined) delete process.env.EMAIL_USER;
  else process.env.EMAIL_USER = originalEmailUser;
  if (originalInquiryEmail === undefined) delete process.env.INQUIRY_NOTIFICATION_EMAIL;
  else process.env.INQUIRY_NOTIFICATION_EMAIL = originalInquiryEmail;
});
