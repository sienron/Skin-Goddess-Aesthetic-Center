const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function applyAndVerifyWindowsAcl(filePath) {
  const script = `
$ErrorActionPreference = 'Stop'
$filePath = [IO.Path]::GetFullPath(${powershellQuote(filePath)})
$acl = Get-Acl -LiteralPath $filePath
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$inheritance = [Security.AccessControl.InheritanceFlags]::None
$propagation = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$fullControl = [Security.AccessControl.FileSystemRights]::FullControl
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($currentSid, $fullControl, $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($systemSid, $fullControl, $inheritance, $propagation, $allow)))
Set-Acl -LiteralPath $filePath -AclObject $acl
$verified = Get-Acl -LiteralPath $filePath
if (-not $verified.AreAccessRulesProtected) { throw 'Credential-file ACL still inherits permissions.' }
$allowedSids = @($currentSid.Value, $systemSid.Value)
$actualSids = @()
foreach ($rule in $verified.Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -ne $allow -or $rule.FileSystemRights -ne $fullControl -or $sid -notin $allowedSids) {
    throw 'Credential-file ACL contains an unexpected access rule.'
  }
  $actualSids += $sid
}
if (($actualSids | Sort-Object -Unique).Count -ne 2) { throw 'Credential-file ACL is missing the current user or SYSTEM.' }
`;
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], { stdio: 'pipe' });
}

function createSecureCredentialFile(filePath, contents) {
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  let closed = false;
  try {
    if (process.platform === 'win32') {
      applyAndVerifyWindowsAcl(path.resolve(filePath));
    } else {
      fs.chmodSync(filePath, 0o600);
      if ((fs.statSync(filePath).mode & 0o077) !== 0) {
        throw new Error('Credential file permissions are not restricted to the current user.');
      }
    }
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    closed = true;
  } catch (error) {
    if (!closed) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.error('Could not remove the incomplete credential file:', cleanupError.message);
    }
    throw error;
  }
}

module.exports = { createSecureCredentialFile };
