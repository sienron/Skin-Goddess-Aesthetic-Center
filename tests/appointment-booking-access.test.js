const test = require('node:test');
const assert = require('node:assert/strict');
const { canBookAppointments } = require('../utils/appointmentBookingAccess');

test('verified clients can book in production', () => {
  assert.equal(canBookAppointments({
    email_verified: true,
    role: 'client',
    dev_access_all: false
  }, 'production'), true);
});

test('local development admin can book when development access is enabled', () => {
  assert.equal(canBookAppointments({
    email_verified: true,
    role: 'admin',
    dev_access_all: true
  }, 'development'), true);
});

test('development booking access does not apply to admins in production', () => {
  assert.equal(canBookAppointments({
    email_verified: true,
    role: 'admin',
    dev_access_all: true
  }, 'production'), false);
});

test('development booking access does not bypass email verification', () => {
  assert.equal(canBookAppointments({
    email_verified: false,
    role: 'admin',
    dev_access_all: true
  }, 'development'), false);
});

test('ordinary admins cannot book as clients', () => {
  assert.equal(canBookAppointments({
    email_verified: true,
    role: 'admin',
    dev_access_all: false
  }, 'development'), false);
});
