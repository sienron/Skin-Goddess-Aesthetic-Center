const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'LoginPage.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'login.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const recoveryPanel = html.match(/<section id="loginRecoveryPanel"[\s\S]*?<\/section>/)?.[0];

test('recovery-code screen offers secure save actions and requires acknowledgement', () => {
  assert.ok(recoveryPanel);
  assert.match(recoveryPanel, /Each recovery code can only be used once\. Store these codes somewhere secure\./);
  assert.match(recoveryPanel, /id="loginCopyRecoveryCodes"/);
  assert.match(recoveryPanel, /id="loginDownloadRecoveryCodes"/);
  assert.match(recoveryPanel, /type="checkbox" id="loginRecoveryAcknowledged"/);
  assert.match(recoveryPanel, /id="loginContinueAfterMfa" disabled/);
  assert.doesNotMatch(html, /This code is valid for 5 minutes\./);
});

test('codes are displayed as text, cleared when leaving, and never written to logs', () => {
  assert.match(script, /value\.textContent = code/);
  assert.match(script, /function clearRecoveryCodes\(\)[\s\S]*?activeRecoveryCodes = \[\][\s\S]*?loginRecoveryCodes\.replaceChildren\(\)/);
  assert.match(script, /if \(!loginRecoveryPanel\.hidden && !loginRecoveryAcknowledged\.checked\)/);
  assert.match(script, /await navigator\.clipboard\.writeText\(activeRecoveryCodes\.join\('\\n'\)\)/);
  assert.match(script, /type: 'text\/plain;charset=utf-8'/);
  assert.match(script, /if \(!loginRecoveryAcknowledged\.checked\)/);
  assert.doesNotMatch(script, /console\.(?:log|info|debug)\([^)]*recovery/i);
});

test('recovery codes use centered monospace containers and retain a narrow-screen layout', () => {
  assert.match(styles, /\.login-recovery-codes\s*\{[^}]*list-style:\s*none/s);
  assert.match(styles, /\.login-recovery-codes li\s*\{[^}]*text-align:\s*center/s);
  assert.match(styles, /\.login-recovery-codes code\s*\{[^}]*font-family:\s*"SFMono-Regular", Consolas, "Liberation Mono", monospace/s);
  assert.match(styles, /@media \(max-width: 420px\)\s*\{\s*\.login-recovery-actions\s*\{\s*flex-direction:\s*column;/);
});
