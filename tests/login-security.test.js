const test = require('node:test');
const assert = require('node:assert/strict');
const { DASHBOARD_PER_ROLE, STAFF_ROLES } = require('../utils/roleRoutes');

test('staff dashboard roles are exempt from login OTP while clients are not', () => {
  assert.deepEqual(STAFF_ROLES, [
    'admin',
    'aesthetician',
    'nail_tech',
    'inventory_officer',
    'finance_officer',
    'staff',
  ]);
  assert.equal(Object.hasOwn(DASHBOARD_PER_ROLE, 'client'), true);
  assert.equal(STAFF_ROLES.includes('client'), false);
  assert.ok(STAFF_ROLES.every((role) => Object.hasOwn(DASHBOARD_PER_ROLE, role)));
});
