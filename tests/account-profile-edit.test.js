const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('profile edit includes address and cancel restores profile details', () => {
  const page = fs.readFileSync(path.join(root, 'UserAccount.html'), 'utf8');
  const profileForm = page.match(/<form id="profile-form"[\s\S]*?<\/form>/)[0];
  assert.match(profileForm, /id="profileDateOfBirthInput"/);
  assert.match(profileForm, /id="profileGenderInput"/);
  assert.match(profileForm, /id="profileAddressInput"/);
  assert.doesNotMatch(page, /id="personalDetailsEditBtn"|id="personal-details-form"/);

  const elements = new Map();
  function element(value = '') {
    const listeners = {};
    return {
      value, listeners, disabled: false, hidden: false,
      addEventListener(type, handler) { listeners[type] = handler; },
      focus() {}
    };
  }
  for (const id of [
    'profileEditBtn', 'profileCancelBtn', 'profileSubmitBtn', 'profileFormActions', 'profile-success',
    'profile-form', 'firstName', 'lastName', 'contactNumber', 'profileDateOfBirthInput',
    'profileGenderInput', 'profileAddressInput'
  ]) elements.set(id, element());
  const date = elements.get('profileDateOfBirthInput');
  const gender = elements.get('profileGenderInput');
  const address = elements.get('profileAddressInput');
  date.value = '1998-04-12';
  gender.value = 'male';
  address.value = 'Old address';

  const document = {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => []
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'account-edit-toggle.js'), 'utf8'), {
    document, MutationObserver: class { observe() {} }
  });
  assert.equal(date.disabled, true);
  assert.equal(gender.disabled, true);
  assert.equal(address.disabled, true);
  elements.get('profileEditBtn').listeners.click();
  assert.equal(date.disabled, false);
  assert.equal(gender.disabled, false);
  assert.equal(address.disabled, false);
  address.value = 'New address';
  address.listeners.input();
  assert.equal(elements.get('profileSubmitBtn').disabled, false);
  gender.value = 'female';
  gender.listeners.change();
  assert.equal(elements.get('profileSubmitBtn').disabled, false);
  date.value = '2000-05-01';
  date.listeners.input();
  elements.get('profileCancelBtn').listeners.click();
  assert.equal(date.value, '1998-04-12');
  assert.equal(gender.value, 'male');
  assert.equal(address.value, 'Old address');
  assert.equal(date.disabled, true);
  assert.equal(gender.disabled, true);
  assert.equal(address.disabled, true);
});
