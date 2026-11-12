const test = require('node:test');
const assert = require('node:assert/strict');
const isValidPassword = require('../utils/password');

test('passwords require 9 to 72 characters, a letter, a number, and a special character', () => {
  assert.equal(isValidPassword('Abcdefg1!'), true);
  assert.equal(isValidPassword('Abcdef1!'), false);
  assert.equal(isValidPassword('12345678!'), false);
  assert.equal(isValidPassword('Abcdefgh!'), false);
  assert.equal(isValidPassword('Abcdefgh1'), false);
});
